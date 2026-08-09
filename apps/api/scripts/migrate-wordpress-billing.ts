/**
 * Migration Phase 2 — Stripe billing continuity for the legacy WooCommerce
 * customers. Run AFTER the Phase-1 migration (scripts/migrate-wordpress.ts) has
 * created the accounts + placeholder subscriptions.
 *
 * The export has a Stripe customer (`cus_…`) and a saved card (`pm_…`) per
 * account but NO native Stripe subscription — WooCommerce owned the schedule. So
 * this creates a native Stripe subscription on the Pro price, charged off the
 * saved card, with `trial_end` set to the WooCommerce next-payment date: no
 * charge now, first platform charge lands exactly when WooCommerce's next one
 * would have. It then replaces the `wc_sub_…` placeholder Subscription row with
 * the real `sub_…`. Rotherham (comp/£0, no card) is skipped.
 *
 *   ⚠️  WooCommerce keeps charging these customers until someone CANCELS those
 *       subscriptions on the WordPress side. Do that (at period end) so nobody
 *       is billed twice. This script cannot touch WordPress.
 *
 * Safe by default: a DRY RUN that reads Stripe + the DB and prints the plan, but
 * creates nothing. Pass --commit to create the subscriptions. Idempotent: an
 * account that already has a migration-created subscription is reused, not
 * duplicated. See docs/adr/0140-wordpress-migration-billing.md.
 *
 *   # dry run
 *   DATABASE_URL=… STRIPE_SECRET_KEY=… [STRIPE_PRICE_ID_PRO=…] \
 *     pnpm --filter @kudos/api run migrate:wordpress-billing -- --data ./migration-data
 *
 *   # for real (use the LIVE Stripe key)
 *   … --data ./migration-data --commit
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { mapStripeSubscriptionStatus } from "../src/webhooks/subscription-status.util";
import {
  buildAllAccountPlans,
  groupContactsByUser,
  indexSubscriptionsByCustomerUser,
  MIGRATION_PLAN_ID,
  parseSubscriptionMeta,
  type AccountPlan,
  type RawContactRow,
} from "../src/migration/wordpress-migration";
import {
  BILLING_MIGRATION_TAG,
  buildSubscriptionParams,
  resolveBillingAction,
} from "../src/migration/woocommerce-billing";

interface Args {
  dataDir: string;
  commit: boolean;
}

function parseArgs(argv: string[]): Args {
  let dataDir = "./migration-data";
  let commit = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (arg === "--commit") {
      commit = true;
    } else if (arg === "--data") {
      dataDir = argv[i + 1] ?? dataDir;
      i += 1;
    } else if (arg.startsWith("--data=")) {
      dataDir = arg.slice("--data=".length);
    }
  }
  return { dataDir, commit };
}

function loadContacts(dataDir: string): RawContactRow[] {
  const files = readdirSync(dataDir).filter((f) => f.endsWith("_contacts.csv"));
  if (files.length === 0) {
    throw new Error(`No *_contacts.csv files found in ${dataDir}`);
  }
  const rows: RawContactRow[] = [];
  for (const file of files) {
    const parsed = parse(readFileSync(path.join(dataDir, file)), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as RawContactRow[];
    rows.push(...parsed);
  }
  return rows;
}

function loadSubscriptionMeta(dataDir: string): string {
  const file = readdirSync(dataDir).find((f) => f.endsWith("subscription_meta.txt"));
  if (!file) {
    throw new Error(`No *subscription_meta.txt file found in ${dataDir}`);
  }
  return readFileSync(path.join(dataDir, file), "utf8");
}

interface BillingOutcome {
  accountName: string;
  ownerEmail: string;
  stripeCustomerId: string | null;
  /** "created" | "reused" | "skipped" | "would-create" | "error" */
  result: string;
  stripeSubscriptionId: string | null;
  firstChargeAt: string | null;
  detail: string;
}

/** The account this plan maps to, found via the Phase-1 placeholder subscription
 * (`wc_sub_<woo>`), falling back to the account's stored Stripe customer id. */
async function findAccountId(prisma: PrismaClient, plan: AccountPlan): Promise<string | null> {
  const placeholder = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: plan.syntheticSubscriptionId },
    select: { accountId: true },
  });
  if (placeholder) {
    return placeholder.accountId;
  }
  if (plan.stripeCustomerId) {
    const account = await prisma.account.findUnique({
      where: { stripeCustomerId: plan.stripeCustomerId },
      select: { id: true },
    });
    return account?.id ?? null;
  }
  return null;
}

/** Reuse (don't duplicate) a subscription this migration already created for the
 * customer — recognised by our metadata tag on any not-dead subscription. */
async function findExistingMigrationSub(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  return (
    subs.data.find(
      (s) =>
        s.metadata?.migratedFrom === BILLING_MIGRATION_TAG &&
        s.status !== "canceled" &&
        s.status !== "incomplete_expired",
    ) ?? null
  );
}

/** Replace the `wc_sub_…` placeholder row with the real subscription, in one
 * transaction, and audit it. The customer.subscription.created webhook will also
 * upsert this row (idempotent) — we do it directly so the DB is correct even if
 * webhooks are delayed or not configured for the run. */
async function persistRealSubscription(
  prisma: PrismaClient,
  accountId: string,
  placeholderId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  const status = mapStripeSubscriptionStatus(sub.status);
  const periodEndUnix = sub.items.data[0]?.current_period_end ?? sub.trial_end ?? undefined;
  const currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : new Date();

  await prisma.$transaction(async (tx) => {
    if (placeholderId !== sub.id) {
      await tx.subscription.deleteMany({
        where: { stripeSubscriptionId: placeholderId, accountId },
      });
    }
    await tx.subscription.upsert({
      where: { stripeSubscriptionId: sub.id },
      create: {
        accountId,
        planId: MIGRATION_PLAN_ID,
        stripeSubscriptionId: sub.id,
        status,
        currentPeriodEnd,
      },
      update: { accountId, planId: MIGRATION_PLAN_ID, status, currentPeriodEnd },
    });
    await tx.auditLogEntry.create({
      data: {
        accountId,
        actorUserId: "system:migration",
        action: "migrate_woocommerce_billing",
        targetType: "Subscription",
        targetId: sub.id,
        metadata: {
          stripeSubscriptionId: sub.id,
          replacedPlaceholder: placeholderId,
          status,
          trialEnd: sub.trial_end,
        },
      },
    });
  });
}

async function processPlan(
  prisma: PrismaClient,
  stripe: Stripe,
  proPriceId: string,
  plan: AccountPlan,
  commit: boolean,
  now: Date,
): Promise<BillingOutcome> {
  const outcome: BillingOutcome = {
    accountName: plan.accountName,
    ownerEmail: plan.owner.email,
    stripeCustomerId: plan.stripeCustomerId,
    result: "skipped",
    stripeSubscriptionId: null,
    firstChargeAt: null,
    detail: "",
  };

  const action = resolveBillingAction(plan, now);
  if (action.kind === "skip") {
    outcome.detail = action.reason;
    return outcome;
  }

  const accountId = await findAccountId(prisma, plan);
  if (!accountId) {
    outcome.detail = "No migrated account found — run Phase 1 (migrate:wordpress) first";
    return outcome;
  }

  // Idempotency: reuse a subscription this migration already created.
  const existing = await findExistingMigrationSub(stripe, plan.stripeCustomerId!);
  if (existing) {
    outcome.result = "reused";
    outcome.stripeSubscriptionId = existing.id;
    outcome.firstChargeAt = existing.trial_end
      ? new Date(existing.trial_end * 1000).toISOString()
      : null;
    outcome.detail = "Migration subscription already exists";
    if (commit) {
      await persistRealSubscription(prisma, accountId, plan.syntheticSubscriptionId, existing);
    }
    return outcome;
  }

  outcome.firstChargeAt = new Date(action.trialEndUnix * 1000).toISOString();

  if (!commit) {
    outcome.result = "would-create";
    outcome.detail = `Would create Pro sub on ${plan.stripeCustomerId} / ${plan.stripePaymentMethodId}, first charge ${outcome.firstChargeAt}`;
    return outcome;
  }

  try {
    const sub = await stripe.subscriptions.create(
      buildSubscriptionParams({
        customer: plan.stripeCustomerId!,
        priceId: proPriceId,
        paymentMethod: plan.stripePaymentMethodId!,
        trialEndUnix: action.trialEndUnix,
        accountId,
        planId: MIGRATION_PLAN_ID,
        wooSubscriptionId: plan.wooSubscriptionId,
      }) as Stripe.SubscriptionCreateParams,
    );
    await persistRealSubscription(prisma, accountId, plan.syntheticSubscriptionId, sub);
    outcome.result = "created";
    outcome.stripeSubscriptionId = sub.id;
    outcome.detail = `Created ${sub.id} (${sub.status})`;
  } catch (error) {
    outcome.result = "error";
    outcome.detail = error instanceof Error ? error.message : String(error);
  }
  return outcome;
}

/** Env `STRIPE_PRICE_ID_PRO` wins (same resolution as checkout), else the seeded
 * plan_entitlements row. */
async function resolveProPriceId(prisma: PrismaClient): Promise<string> {
  const fromEnv = process.env.STRIPE_PRICE_ID_PRO?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const entitlement = await prisma.planEntitlement.findUnique({
    where: { planId: MIGRATION_PLAN_ID },
    select: { stripePriceId: true },
  });
  if (!entitlement?.stripePriceId) {
    throw new Error(
      "No Pro price id: set STRIPE_PRICE_ID_PRO or seed plan_entitlements.stripePriceId (setup:stripe-plans)",
    );
  }
  return entitlement.stripePriceId;
}

function writeReport(dataDir: string, payload: unknown): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dataDir, `billing-migration-report-${stamp}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

async function main(): Promise<void> {
  const { dataDir, commit } = parseArgs(process.argv.slice(2));

  const contacts = loadContacts(dataDir);
  const subsByCustomer = indexSubscriptionsByCustomerUser(
    parseSubscriptionMeta(loadSubscriptionMeta(dataDir)),
  );
  const plans = buildAllAccountPlans(groupContactsByUser(contacts), subsByCustomer);

  const databaseUrl = requireEnv("DATABASE_URL");
  const stripeKey = requireEnv("STRIPE_SECRET_KEY");
  const mode = stripeKey.startsWith("sk_live_") ? "LIVE" : "test";
  console.log(`Stripe mode: ${mode}. ${commit ? "COMMIT" : "DRY RUN"}.\n`);

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const stripe = new Stripe(stripeKey);
  const now = new Date();

  const outcomes: BillingOutcome[] = [];
  try {
    const proPriceId = await resolveProPriceId(prisma);
    for (const plan of plans) {
      const outcome = await processPlan(prisma, stripe, proPriceId, plan, commit, now);
      outcomes.push(outcome);
      console.log(
        `• ${outcome.accountName.padEnd(28)} ${outcome.result.padEnd(13)} ` +
          `${outcome.firstChargeAt ? `first charge ${outcome.firstChargeAt.slice(0, 10)}  ` : ""}` +
          `${outcome.detail}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }

  const reportFile = writeReport(dataDir, {
    mode: commit ? "commit" : "dry-run",
    generatedAt: new Date().toISOString(),
    accounts: outcomes,
  });

  console.log(`\nReport: ${reportFile}`);
  console.log(
    "\n⚠️  Next step (outside this repo): CANCEL the WooCommerce subscriptions on\n" +
      "    WordPress so these customers aren't billed twice. Each new Stripe sub's\n" +
      "    first charge is shown above — cancel WooCommerce before those dates.",
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
