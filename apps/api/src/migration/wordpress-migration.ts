/**
 * Pure mapping + join logic for the one-off WordPress/WooCommerce → Kudos
 * migration (Phase 1: accounts, owners, recipients, subscription status).
 *
 * This file is deliberately free of Prisma, Supabase and filesystem I/O so the
 * risky parts — the CSV/meta parsing, the contacts↔subscription join, and the
 * per-field mapping — are unit-testable against synthetic fixtures (never real
 * children's data). The runnable orchestrator (scripts/migrate-wordpress.ts)
 * turns these plain objects into DB writes and Supabase invite links.
 *
 * See docs/adr/0139-wordpress-migration.md.
 */

/** Recipients land under this `source` and are keyed on (accountId, source,
 * externalId) — the legacy WooCommerce contact id — so a re-run upserts the same
 * row instead of duplicating. Mirrors the CRM ingest convention (ADR 0015). */
export const MIGRATION_SOURCE = "wordpress";

/** Phase-1 decision: every migrated centre lands on the Pro plan. */
export const MIGRATION_PLAN_ID = "pro";

/** Phase-1 decision: subscriptions are marked active now; real Stripe linking is
 * a follow-up (see ADR 0139 "Out of scope"). */
export const MIGRATION_SUBSCRIPTION_STATUS = "active" as const;

/** WooCommerce placeholder address used for contacts with no real email — treat
 * it as "no email on file" rather than importing a junk address. */
const PLACEHOLDER_EMAIL = "blank@blank.com";

export type RecipientStatus = "active" | "archived";

/** A single contacts-CSV row, using the export's own column names. Only the
 * columns the migration reads are typed; the parser passes through the rest. */
export interface RawContactRow {
  account_name: string;
  legacy_contact_id: string;
  legacy_user_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  contact_status: string;
  contact_type: string;
  address_line_1: string;
  city: string;
  postcode: string;
  email: string;
}

export interface MappedRecipient {
  /** legacy_contact_id — the stable external key for idempotent upserts. */
  externalId: string;
  firstName: string;
  lastName: string;
  /** ISO yyyy-mm-dd, or null if absent/unparseable/in the future. */
  dateOfBirth: string | null;
  email: string | null;
  addressLine1: string | null;
  addressCity: string | null;
  addressPostcode: string | null;
  /** WooCommerce `former` → archived (kept for history, not actively sent to);
   * anything else → active. */
  status: RecipientStatus;
}

export interface AccountPlan {
  /** Join key: contacts.legacy_user_id === subscription._customer_user. */
  legacyUserId: string;
  accountName: string;
  owner: { email: string; firstName: string | null; lastName: string | null };
  /** From subscription meta `_stripe_customer_id`; null for the comp account. */
  stripeCustomerId: string | null;
  /** The WooCommerce subscription id, e.g. "2377". */
  wooSubscriptionId: string;
  /** Placeholder Stripe-subscription id used until the follow-up Stripe PR wires
   * the real `sub_…`. Stable + unique so the subscription row upserts cleanly. */
  syntheticSubscriptionId: string;
  /** currentPeriodEnd, from `_schedule_next_payment`. Null if the export omits it. */
  nextPaymentAt: string | null;
  recipients: MappedRecipient[];
  /** Non-fatal data-quality notes surfaced in the review report. */
  warnings: string[];
}

/** Normalise a contact/owner email: trim + lowercase; the WooCommerce
 * `blank@blank.com` placeholder and empty strings become null. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? "").trim().toLowerCase();
  if (!email || email === PLACEHOLDER_EMAIL) {
    return null;
  }
  return email;
}

/** WooCommerce contact_status → Kudos recipient status. Only `former` is
 * archived; the export uses `active` for everyone else. */
export function mapContactStatus(contactStatus: string): RecipientStatus {
  return contactStatus.trim().toLowerCase() === "former" ? "archived" : "active";
}

/** Parse a `yyyy-mm-dd` date of birth. Returns null (not a throw) for an
 * absent, malformed, or impossible/future date so one bad cell never blocks a
 * contact — the caller records a warning instead. */
export function parseDateOfBirth(
  raw: string | null | undefined,
  today: Date = new Date(),
): { value: string | null; warning: string | null } {
  const text = (raw ?? "").trim();
  if (!text) {
    return { value: null, warning: null };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { value: null, warning: `Unparseable date_of_birth "${text}" — dropped` };
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return { value: null, warning: `Invalid date_of_birth "${text}" — dropped` };
  }
  // A birthday in the future is a data-entry slip (e.g. a mistyped year); keep
  // the contact but drop the date so we don't schedule a nonsensical birthday.
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (parsed.getTime() > todayUtc.getTime()) {
    return { value: null, warning: `Future date_of_birth "${text}" — dropped` };
  }
  return { value: text, warning: null };
}

/** Trim a free-text field to null when empty. */
function nullIfBlank(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  return text || null;
}

/** Map one contacts row to a recipient, collecting any per-field warnings. */
export function mapContactToRecipient(
  row: RawContactRow,
  today: Date = new Date(),
): { recipient: MappedRecipient; warnings: string[] } {
  const warnings: string[] = [];
  const dob = parseDateOfBirth(row.date_of_birth, today);
  if (dob.warning) {
    warnings.push(`contact ${row.legacy_contact_id}: ${dob.warning}`);
  }
  const recipient: MappedRecipient = {
    externalId: row.legacy_contact_id.trim(),
    firstName: row.first_name.trim(),
    lastName: row.last_name.trim(),
    dateOfBirth: dob.value,
    email: normalizeEmail(row.email),
    addressLine1: nullIfBlank(row.address_line_1),
    addressCity: nullIfBlank(row.city),
    addressPostcode: nullIfBlank(row.postcode),
    status: mapContactStatus(row.contact_status),
  };
  return { recipient, warnings };
}

/**
 * Parse the tab-separated subscription-meta dump into
 * `subscriptionId → { metaKey: metaValue }`. Splits on the first two tabs only,
 * so a meta value that itself contains a tab is preserved intact.
 */
export function parseSubscriptionMeta(tsv: string): Map<string, Record<string, string>> {
  const bySub = new Map<string, Record<string, string>>();
  const lines = tsv.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    // Skip the header row.
    if (line.startsWith("subscription_id\t")) {
      continue;
    }
    const firstTab = line.indexOf("\t");
    if (firstTab === -1) {
      continue;
    }
    const secondTab = line.indexOf("\t", firstTab + 1);
    const subId = line.slice(0, firstTab).trim();
    const key = (
      secondTab === -1 ? line.slice(firstTab + 1) : line.slice(firstTab + 1, secondTab)
    ).trim();
    const value = secondTab === -1 ? "" : line.slice(secondTab + 1);
    if (!subId || !key) {
      continue;
    }
    const record = bySub.get(subId) ?? {};
    record[key] = value;
    bySub.set(subId, record);
  }
  return bySub;
}

/** Index parsed subscription meta by the WooCommerce `_customer_user` id — the
 * key the contacts export joins on via `legacy_user_id`. Throws if two
 * subscriptions claim the same customer (the join would be ambiguous). */
export function indexSubscriptionsByCustomerUser(
  bySub: Map<string, Record<string, string>>,
): Map<string, { subscriptionId: string; meta: Record<string, string> }> {
  const byCustomer = new Map<string, { subscriptionId: string; meta: Record<string, string> }>();
  for (const [subscriptionId, meta] of bySub) {
    const customerUser = (meta._customer_user ?? "").trim();
    if (!customerUser) {
      continue;
    }
    if (byCustomer.has(customerUser)) {
      throw new Error(
        `Two subscriptions map to customer_user ${customerUser}: ` +
          `${byCustomer.get(customerUser)!.subscriptionId} and ${subscriptionId}`,
      );
    }
    byCustomer.set(customerUser, { subscriptionId, meta });
  }
  return byCustomer;
}

/** Convert a WooCommerce `YYYY-MM-DD HH:MM:SS` timestamp to an ISO string,
 * interpreted as UTC. Returns null for an absent/zero value. The follow-up
 * Stripe PR replaces this with the authoritative period end from Stripe. */
export function parseWooTimestamp(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text || text === "0") {
    return null;
  }
  const iso = text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Build one account's migration plan from its contacts rows + matched
 * subscription meta. Pure: no I/O, no throw for recoverable data issues (those
 * become warnings) — only a missing owner email is fatal, since an account with
 * no login is meaningless. */
export function buildAccountPlan(
  legacyUserId: string,
  contacts: RawContactRow[],
  subscription: { subscriptionId: string; meta: Record<string, string> },
  today: Date = new Date(),
): AccountPlan {
  const warnings: string[] = [];
  const { meta } = subscription;

  const accountNames = new Set(contacts.map((c) => c.account_name.trim()).filter(Boolean));
  if (accountNames.size > 1) {
    warnings.push(`Multiple account_name values in one file: ${[...accountNames].join(" | ")}`);
  }
  const accountName = [...accountNames][0] ?? `Account ${legacyUserId}`;

  const ownerEmail = normalizeEmail(meta._billing_email);
  if (!ownerEmail) {
    throw new Error(
      `Subscription ${subscription.subscriptionId} (customer ${legacyUserId}) has no billing email`,
    );
  }

  const recipients: MappedRecipient[] = [];
  const seenExternalIds = new Set<string>();
  for (const row of contacts) {
    const { recipient, warnings: rowWarnings } = mapContactToRecipient(row, today);
    warnings.push(...rowWarnings);
    if (seenExternalIds.has(recipient.externalId)) {
      warnings.push(`Duplicate legacy_contact_id ${recipient.externalId} — keeping the last`);
      const idx = recipients.findIndex((r) => r.externalId === recipient.externalId);
      recipients[idx] = recipient;
      continue;
    }
    seenExternalIds.add(recipient.externalId);
    recipients.push(recipient);
  }

  return {
    legacyUserId,
    accountName,
    owner: {
      email: ownerEmail,
      firstName: nullIfBlank(meta._billing_first_name),
      lastName: nullIfBlank(meta._billing_last_name),
    },
    stripeCustomerId: nullIfBlank(meta._stripe_customer_id),
    wooSubscriptionId: subscription.subscriptionId,
    syntheticSubscriptionId: `wc_sub_${subscription.subscriptionId}`,
    nextPaymentAt: parseWooTimestamp(meta._schedule_next_payment),
    recipients,
    warnings,
  };
}

/**
 * Join every contacts group to its subscription and produce the full set of
 * account plans. `contactsByUser` is keyed on legacy_user_id; the subscription
 * index is keyed on the same id. A contacts group with no matching
 * subscription is fatal (we won't create an account with no plan/owner).
 */
export function buildAllAccountPlans(
  contactsByUser: Map<string, RawContactRow[]>,
  subscriptionsByCustomer: Map<string, { subscriptionId: string; meta: Record<string, string> }>,
  today: Date = new Date(),
): AccountPlan[] {
  const plans: AccountPlan[] = [];
  for (const [legacyUserId, contacts] of contactsByUser) {
    const subscription = subscriptionsByCustomer.get(legacyUserId);
    if (!subscription) {
      throw new Error(
        `No subscription found for contacts group legacy_user_id=${legacyUserId} ` +
          `(account "${contacts[0]?.account_name ?? "?"}")`,
      );
    }
    plans.push(buildAccountPlan(legacyUserId, contacts, subscription, today));
  }
  return plans;
}

/** Group parsed contact rows by their legacy_user_id (the account join key). */
export function groupContactsByUser(rows: RawContactRow[]): Map<string, RawContactRow[]> {
  const byUser = new Map<string, RawContactRow[]>();
  for (const row of rows) {
    const key = row.legacy_user_id.trim();
    const group = byUser.get(key) ?? [];
    group.push(row);
    byUser.set(key, group);
  }
  return byUser;
}
