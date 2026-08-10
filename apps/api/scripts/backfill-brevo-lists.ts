/**
 * One-off backfill: add EXISTING subscribers to our Brevo marketing lists, the
 * same split new signups now get automatically — individuals → the personal
 * list, organisations → the organisation list (ADR 0152). Run this once after
 * shipping the signup sync so historical accounts land in the lists too.
 *
 * Data source is our own DB: each account's owner email (the owner membership's
 * email, falling back to the account's contactEmail) plus the account type and
 * name. Names map to Brevo FIRSTNAME/LASTNAME (individuals, split from `name`)
 * or COMPANY (organisations) via the same deriveContactName helper the live
 * sync uses. Accounts with no resolvable email are skipped (nothing to add).
 *
 * Safe by default: a DRY RUN that prints what it WOULD send and writes nothing.
 * Pass --apply to actually upsert into Brevo. Idempotent — Brevo upserts on
 * email (updateEnabled), so re-running updates the same contacts, never dupes.
 * Requests are paced (~5/s) to stay under Brevo's rate limit.
 *
 *   # dry run — prints the plan, touches nothing
 *   DATABASE_URL=… Brevo_API=… pnpm --filter @kudos/api run backfill:brevo-lists
 *
 *   # for real
 *   DATABASE_URL=… Brevo_API=… BREVO_LIST_ID_INDIVIDUAL=5 BREVO_LIST_ID_ORGANISATION=6 \
 *     pnpm --filter @kudos/api run backfill:brevo-lists -- --apply
 */
import { PrismaClient } from "@prisma/client";
import { HttpMarketingContactsClient } from "../src/marketing/http-marketing-contacts.client";
import { deriveContactName } from "../src/marketing/derive-contact-name";

const APPLY = process.argv.includes("--apply");
const INDIVIDUAL_LIST = Number(process.env.BREVO_LIST_ID_INDIVIDUAL ?? 5) || 5;
const ORGANISATION_LIST = Number(process.env.BREVO_LIST_ID_ORGANISATION ?? 6) || 6;
const PACING_MS = 200; // ~5 requests/second

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const apiKey = process.env.Brevo_API;
  if (APPLY && !apiKey) {
    throw new Error("Brevo_API must be set to run with --apply");
  }
  const client = apiKey ? new HttpMarketingContactsClient(apiKey) : null;

  const accounts = await prisma.account.findMany({
    select: {
      id: true,
      type: true,
      name: true,
      contactEmail: true,
      memberships: {
        where: { role: "owner" },
        select: { email: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} — ${accounts.length} accounts; ` +
      `lists: individual=${INDIVIDUAL_LIST} organisation=${ORGANISATION_LIST}\n`,
  );

  for (const account of accounts) {
    const email = account.memberships[0]?.email ?? account.contactEmail;
    if (!email) {
      skipped += 1;
      console.log(`SKIP  ${account.id} (${account.type}) — no email`);
      continue;
    }
    const listId = account.type === "organisation" ? ORGANISATION_LIST : INDIVIDUAL_LIST;
    const { firstName, lastName, company } = deriveContactName(account.type, account.name);

    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    const label =
      `${email} → list ${listId}` +
      (company ? ` COMPANY="${company}"` : "") +
      (fullName ? ` NAME="${fullName}"` : "");

    if (!APPLY || !client) {
      console.log(`PLAN  ${label}`);
      synced += 1;
      continue;
    }

    try {
      await client.upsertContact({ email, firstName, lastName, company, listId });
      synced += 1;
      console.log(`OK    ${label}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL  ${label} — ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(PACING_MS);
  }

  console.log(
    `\nDone. ${APPLY ? "synced" : "planned"}=${synced} skipped=${skipped} failed=${failed}`,
  );
  await prisma.$disconnect();
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
