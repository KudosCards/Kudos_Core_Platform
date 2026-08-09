/**
 * One-off migration: import the legacy WordPress/WooCommerce customers into the
 * Kudos platform — Phase 1 (accounts, owners, recipients, subscription status).
 *
 *   Owner login .......... a branded "set your password" invite link (Supabase
 *                          service-role generateLink); no shared password.
 *   Plan ................. Pro, marked active now.
 *   Subscription ......... status active, currentPeriodEnd from WooCommerce.
 *                          Real Stripe linking is a FOLLOW-UP PR (see ADR 0139).
 *   Recipients ........... source "wordpress", keyed on the legacy contact id;
 *                          `former` contacts archived; birthdays scheduled.
 *
 * Safe by default: a DRY RUN that writes nothing and mints no links. Pass
 * --commit to actually create the Supabase users, DB rows and invite links.
 * Idempotent: re-running upserts the same accounts (matched by owner user id),
 * subscriptions and recipients rather than duplicating.
 *
 *   # dry run — prints the review report, touches nothing
 *   DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… WEB_APP_URL=… \
 *     pnpm --filter @kudos/api run migrate:wordpress -- --data ./migration-data
 *
 *   # for real
 *   … pnpm --filter @kudos/api run migrate:wordpress -- --data ./migration-data --commit
 *
 * The export files and the generated report contain children's personal data
 * and set-password links — they live in the gitignored ./migration-data dir and
 * are NEVER committed. See docs/adr/0139-wordpress-migration.md.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { PrismaClient, type Prisma, type RecipientStatus } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildScheduledBirthdayOccasion } from "../src/occasions/birthday-occasion.util";
import {
  buildAllAccountPlans,
  groupContactsByUser,
  indexSubscriptionsByCustomerUser,
  MIGRATION_PLAN_ID,
  MIGRATION_SOURCE,
  MIGRATION_SUBSCRIPTION_STATUS,
  parseSubscriptionMeta,
  type AccountPlan,
  type MappedRecipient,
  type RawContactRow,
} from "../src/migration/wordpress-migration";

interface Args {
  dataDir: string;
  commit: boolean;
  /** Set a per-owner temporary password and record it in the commit report, so
   * an operator can log in to each account and verify everything BEFORE the
   * owners are ever sent their set-password link. See docs/adr/0140. */
  tempPassword: boolean;
}

function parseArgs(argv: string[]): Args {
  let dataDir = "./migration-data";
  let commit = false;
  let tempPassword = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (arg === "--commit") {
      commit = true;
    } else if (arg === "--temp-password" || arg === "--temp-passwords") {
      tempPassword = true;
    } else if (arg === "--data") {
      dataDir = argv[i + 1] ?? dataDir;
      i += 1;
    } else if (arg.startsWith("--data=")) {
      dataDir = arg.slice("--data=".length);
    }
  }
  return { dataDir, commit, tempPassword };
}

/** A strong, random per-account temporary password for the verify-first step.
 * base64url gives mixed case + digits; the `Kc-` prefix guarantees a letter and
 * a symbol so it satisfies any minimum-complexity rule. */
function generateTempPassword(): string {
  return `Kc-${randomBytes(15).toString("base64url")}`;
}

/** Read every `*_contacts.csv` in the data dir into typed rows. */
function loadContacts(dataDir: string): RawContactRow[] {
  const files = readdirSync(dataDir).filter((f) => f.endsWith("_contacts.csv"));
  if (files.length === 0) {
    throw new Error(`No *_contacts.csv files found in ${dataDir}`);
  }
  const rows: RawContactRow[] = [];
  for (const file of files) {
    const buffer = readFileSync(path.join(dataDir, file));
    // The export quotes fields that contain commas (addresses, cities), so a
    // spec-compliant CSV parser aligns columns correctly; `bom` strips the
    // UTF-8 byte-order mark the first header carries.
    const parsed = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as RawContactRow[];
    rows.push(...parsed);
  }
  return rows;
}

/** The subscription meta dump ships as a single tab-separated file. */
function loadSubscriptionMeta(dataDir: string): string {
  const file = readdirSync(dataDir).find((f) => f.endsWith("subscription_meta.txt"));
  if (!file) {
    throw new Error(`No *subscription_meta.txt file found in ${dataDir}`);
  }
  return readFileSync(path.join(dataDir, file), "utf8");
}

/** Print the human-readable review table that a person signs off before commit. */
function printReview(plans: AccountPlan[]): void {
  console.log("\n=== Migration review ===\n");
  for (const plan of plans) {
    const active = plan.recipients.filter((r) => r.status === "active").length;
    const archived = plan.recipients.length - active;
    const withDob = plan.recipients.filter((r) => r.dateOfBirth).length;
    console.log(`• ${plan.accountName}`);
    console.log(`    owner:        ${plan.owner.email}`);
    console.log(
      `    plan:         ${MIGRATION_PLAN_ID} (subscription ${MIGRATION_SUBSCRIPTION_STATUS})` +
        `  next payment: ${plan.nextPaymentAt ?? "—"}`,
    );
    console.log(
      `    stripe cust:  ${plan.stripeCustomerId ?? "— (comp / manual)"}` +
        `  woo sub: ${plan.wooSubscriptionId}`,
    );
    console.log(
      `    recipients:   ${plan.recipients.length} (${active} active, ${archived} archived)` +
        `  with birthday: ${withDob}`,
    );
    if (plan.warnings.length > 0) {
      console.log(`    warnings:     ${plan.warnings.length}`);
      for (const warning of plan.warnings.slice(0, 5)) {
        console.log(`      - ${warning}`);
      }
      if (plan.warnings.length > 5) {
        console.log(`      … and ${plan.warnings.length - 5} more (see report)`);
      }
    }
    console.log("");
  }
  const totals = plans.reduce(
    (acc, p) => {
      acc.accounts += 1;
      acc.recipients += p.recipients.length;
      acc.warnings += p.warnings.length;
      return acc;
    },
    { accounts: 0, recipients: 0, warnings: 0 },
  );
  console.log(
    `Totals: ${totals.accounts} accounts, ${totals.recipients} recipients, ` +
      `${totals.warnings} warnings.\n`,
  );
}

interface AccountOutcome {
  accountName: string;
  ownerEmail: string;
  accountId: string;
  /** The one-time set-password link for the owner (only in --commit). */
  setPasswordLink: string | null;
  linkType: "invite" | "recovery" | null;
  /** A temporary password for verify-first login, set only when --temp-password
   * is passed. Null otherwise. A SECRET — lives only in the private report. */
  tempPassword: string | null;
  recipientsCreated: number;
  recipientsUpdated: number;
  recipientsArchived: number;
  recipientsSkipped: number;
  birthdaysScheduled: number;
  warnings: string[];
}

/** Look up a Supabase auth user id by email, paging through the admin list (the
 * fleet is a handful of owners, so a page or two suffices). */
async function findAuthUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw error;
    }
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (match) {
      return match.id;
    }
    if (data.users.length < 200) {
      break;
    }
  }
  return null;
}

/**
 * Ensure the owner has a Supabase auth user and mint a one-time set-password
 * link. A new owner gets an `invite` link (which also creates the auth user); an
 * owner whose email already exists gets a `recovery` link instead. Mirrors the
 * operator-invite flow (admin-team.service.ts / ADR 0051): we build our own link
 * to /reset-password carrying the token_hash, which the page verifies with
 * supabase.auth.verifyOtp (PKCE-safe and immune to email link scanners).
 */
async function ensureOwnerAndLink(
  admin: SupabaseClient,
  webAppUrl: string,
  email: string,
): Promise<{ userId: string; link: string; linkType: "invite" | "recovery" }> {
  const redirectTo = `${webAppUrl}/reset-password`;

  const invite = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });
  if (!invite.error && invite.data.properties?.hashed_token) {
    const userId = invite.data.user?.id ?? (await findAuthUserId(admin, email));
    if (!userId) {
      throw new Error(`Invite succeeded but could not resolve user id for ${email}`);
    }
    const link = `${redirectTo}?token_hash=${encodeURIComponent(invite.data.properties.hashed_token)}&type=invite`;
    return { userId, link, linkType: "invite" };
  }
  // Already registered (a prior run, or the email pre-existed) — mint a recovery
  // link against the existing user so they can still set a password.
  const recovery = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  if (recovery.error || !recovery.data.properties?.hashed_token) {
    throw new Error(
      `Could not mint a set-password link for ${email}: ${recovery.error?.message ?? "no token"}`,
    );
  }
  const userId = recovery.data.user?.id ?? (await findAuthUserId(admin, email));
  if (!userId) {
    throw new Error(`Recovery link minted but could not resolve user id for ${email}`);
  }
  const link = `${redirectTo}?token_hash=${encodeURIComponent(recovery.data.properties.hashed_token)}&type=recovery`;
  return { userId, link, linkType: "recovery" };
}

/** Upsert the account + owner membership, matched on the stable Supabase user
 * id so a re-run updates the same account rather than creating a second one. */
async function upsertAccount(
  prisma: PrismaClient,
  plan: AccountPlan,
  ownerUserId: string,
): Promise<string> {
  const existingMembership = await prisma.membership.findFirst({
    where: { userId: ownerUserId, role: "owner" },
    select: { accountId: true },
  });

  if (existingMembership) {
    await prisma.account.update({
      where: { id: existingMembership.accountId },
      data: {
        name: plan.accountName,
        planId: MIGRATION_PLAN_ID,
        contactEmail: plan.owner.email,
        ...(plan.stripeCustomerId ? { stripeCustomerId: plan.stripeCustomerId } : {}),
      },
    });
    return existingMembership.accountId;
  }

  const account = await prisma.account.create({
    data: {
      type: "organisation",
      name: plan.accountName,
      planId: MIGRATION_PLAN_ID,
      contactEmail: plan.owner.email,
      stripeCustomerId: plan.stripeCustomerId ?? undefined,
      memberships: {
        create: { userId: ownerUserId, role: "owner", email: plan.owner.email },
      },
    },
    select: { id: true },
  });
  return account.id;
}

/** Upsert the subscription row, keyed on the placeholder Stripe-subscription id
 * (the follow-up Stripe PR swaps in the real sub_… and status). */
async function upsertSubscription(
  prisma: PrismaClient,
  accountId: string,
  plan: AccountPlan,
): Promise<void> {
  const currentPeriodEnd = plan.nextPaymentAt ? new Date(plan.nextPaymentAt) : new Date();
  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: plan.syntheticSubscriptionId },
    create: {
      accountId,
      planId: MIGRATION_PLAN_ID,
      stripeSubscriptionId: plan.syntheticSubscriptionId,
      status: MIGRATION_SUBSCRIPTION_STATUS,
      currentPeriodEnd,
    },
    update: {
      accountId,
      planId: MIGRATION_PLAN_ID,
      status: MIGRATION_SUBSCRIPTION_STATUS,
      currentPeriodEnd,
    },
  });
}

function toRecipientData(
  accountId: string,
  recipient: MappedRecipient,
): Prisma.RecipientUncheckedCreateInput {
  return {
    accountId,
    source: MIGRATION_SOURCE,
    externalId: recipient.externalId,
    firstName: recipient.firstName,
    lastName: recipient.lastName,
    email: recipient.email,
    dateOfBirth: recipient.dateOfBirth ? new Date(`${recipient.dateOfBirth}T00:00:00Z`) : null,
    addressLine1: recipient.addressLine1,
    addressCity: recipient.addressCity,
    addressPostcode: recipient.addressPostcode,
    addressCountry: "GB",
    status: recipient.status as RecipientStatus,
  };
}

/** Upsert every recipient on (accountId, source, externalId), then ensure a
 * birthday occasion for each active recipient that has a DOB. */
async function upsertRecipients(
  prisma: PrismaClient,
  accountId: string,
  plan: AccountPlan,
  outcome: AccountOutcome,
): Promise<void> {
  const birthdayInputs: Prisma.OccasionCreateManyInput[] = [];
  const today = new Date();

  for (const recipient of plan.recipients) {
    const data = toRecipientData(accountId, recipient);
    try {
      const existing = await prisma.recipient.findUnique({
        where: {
          recipient_source_key: {
            accountId,
            source: MIGRATION_SOURCE,
            externalId: recipient.externalId,
          },
        },
        select: { id: true },
      });
      let recipientId: string;
      if (existing) {
        await prisma.recipient.update({ where: { id: existing.id }, data });
        recipientId = existing.id;
        outcome.recipientsUpdated += 1;
      } else {
        const created = await prisma.recipient.create({ data, select: { id: true } });
        recipientId = created.id;
        outcome.recipientsCreated += 1;
      }
      if (recipient.status === "archived") {
        outcome.recipientsArchived += 1;
      }
      if (recipient.status === "active" && recipient.dateOfBirth) {
        birthdayInputs.push(
          buildScheduledBirthdayOccasion(
            {
              id: recipientId,
              accountId,
              dateOfBirth: new Date(`${recipient.dateOfBirth}T00:00:00Z`),
            },
            today,
          ),
        );
      }
    } catch (error) {
      // A collision with the name+postcode+DOB dedupe key (a genuine same-person
      // duplicate under a different legacy id) is skipped, not fatal.
      const message = error instanceof Error ? error.message : String(error);
      outcome.recipientsSkipped += 1;
      outcome.warnings.push(`recipient ${recipient.externalId}: ${message.split("\n")[0]}`);
    }
  }

  if (birthdayInputs.length > 0) {
    const result = await prisma.occasion.createMany({ data: birthdayInputs, skipDuplicates: true });
    outcome.birthdaysScheduled = result.count;
  }
}

async function commitPlan(
  prisma: PrismaClient,
  admin: SupabaseClient,
  webAppUrl: string,
  plan: AccountPlan,
  tempPassword: boolean,
): Promise<AccountOutcome> {
  const outcome: AccountOutcome = {
    accountName: plan.accountName,
    ownerEmail: plan.owner.email,
    accountId: "",
    setPasswordLink: null,
    linkType: null,
    tempPassword: null,
    recipientsCreated: 0,
    recipientsUpdated: 0,
    recipientsArchived: 0,
    recipientsSkipped: 0,
    birthdaysScheduled: 0,
    warnings: [...plan.warnings],
  };

  const { userId, link, linkType } = await ensureOwnerAndLink(admin, webAppUrl, plan.owner.email);
  outcome.setPasswordLink = link;
  outcome.linkType = linkType;

  // Verify-first: give the owner a known temporary password (and confirm the
  // email so password sign-in works immediately) so an operator can log in and
  // check the account before the owner is ever contacted. The owner's
  // set-password link still overrides this whenever they onboard.
  if (tempPassword) {
    const password = generateTempPassword();
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (error) {
      throw new Error(
        `Could not set a temporary password for ${plan.owner.email}: ${error.message}`,
      );
    }
    outcome.tempPassword = password;
  }

  const accountId = await upsertAccount(prisma, plan, userId);
  outcome.accountId = accountId;

  await upsertSubscription(prisma, accountId, plan);
  await upsertRecipients(prisma, accountId, plan, outcome);

  // Audited: importing children's personal data is a UK GDPR event we must be
  // able to evidence. actorUserId is the owner we just provisioned.
  await prisma.auditLogEntry.create({
    data: {
      accountId,
      actorUserId: userId,
      action: "migrate_wordpress",
      targetType: "Account",
      targetId: accountId,
      metadata: {
        source: MIGRATION_SOURCE,
        wooSubscriptionId: plan.wooSubscriptionId,
        recipientsCreated: outcome.recipientsCreated,
        recipientsUpdated: outcome.recipientsUpdated,
        recipientsSkipped: outcome.recipientsSkipped,
        birthdaysScheduled: outcome.birthdaysScheduled,
      },
    },
  });

  return outcome;
}

function writeReport(dataDir: string, payload: unknown): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dataDir, `migration-report-${stamp}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

async function main(): Promise<void> {
  const { dataDir, commit, tempPassword } = parseArgs(process.argv.slice(2));

  const contacts = loadContacts(dataDir);
  const subsByCustomer = indexSubscriptionsByCustomerUser(
    parseSubscriptionMeta(loadSubscriptionMeta(dataDir)),
  );
  const plans = buildAllAccountPlans(groupContactsByUser(contacts), subsByCustomer);

  printReview(plans);

  if (!commit) {
    const reportFile = writeReport(dataDir, {
      mode: "dry-run",
      generatedAt: new Date().toISOString(),
      accounts: plans.map((p) => ({
        accountName: p.accountName,
        ownerEmail: p.owner.email,
        plan: MIGRATION_PLAN_ID,
        subscriptionStatus: MIGRATION_SUBSCRIPTION_STATUS,
        nextPaymentAt: p.nextPaymentAt,
        stripeCustomerId: p.stripeCustomerId,
        wooSubscriptionId: p.wooSubscriptionId,
        recipientCount: p.recipients.length,
        warnings: p.warnings,
      })),
    });
    console.log(`DRY RUN — nothing was written. Review report: ${reportFile}`);
    console.log("Re-run with --commit to create accounts, owners and recipients.");
    return;
  }

  const databaseUrl = requireEnv("DATABASE_URL");
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const webAppUrl = requireEnv("WEB_APP_URL").replace(/\/$/, "");

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const outcomes: AccountOutcome[] = [];
  try {
    for (const plan of plans) {
      console.log(`Migrating "${plan.accountName}" (${plan.owner.email})…`);
      outcomes.push(await commitPlan(prisma, admin, webAppUrl, plan, tempPassword));
    }
  } finally {
    await prisma.$disconnect();
  }

  const reportFile = writeReport(dataDir, {
    mode: "commit",
    generatedAt: new Date().toISOString(),
    accounts: outcomes,
  });

  console.log("\n=== Done ===");
  for (const outcome of outcomes) {
    console.log(
      `• ${outcome.accountName}: created ${outcome.recipientsCreated}, ` +
        `updated ${outcome.recipientsUpdated}, archived ${outcome.recipientsArchived}, ` +
        `skipped ${outcome.recipientsSkipped}, birthdays ${outcome.birthdaysScheduled}`,
    );
  }
  if (tempPassword) {
    console.log("\nVerify-first temporary logins (in the report — SECRET):");
    for (const outcome of outcomes) {
      console.log(`  ${outcome.ownerEmail}  →  ${outcome.tempPassword ?? "—"}`);
    }
    console.log(
      "\nLog in as each owner with the temp password above and check everything.\n" +
        "When you're happy, send owners their set-password link (also in the report) or\n" +
        "point them at 'Forgot password' — either overrides the temp password.",
    );
  } else {
    console.log("\nNo temp passwords were set (pass --temp-password to verify accounts first).");
  }
  console.log(
    `\nReport (owner set-password links${tempPassword ? " + temp passwords" : ""} inside — ` +
      `treat as secret, delete once used): ${reportFile}`,
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
