/**
 * Pure decision logic for the WooCommerce → Stripe billing-continuity follow-up
 * (Phase 2 of the migration). No Stripe/Prisma/IO — just "given this account's
 * export data and the clock, what should we do?" — so the money-sensitive rules
 * are unit-testable against synthetic fixtures.
 *
 * Background (see docs/adr/0140): the export has a Stripe *customer* (`cus_…`)
 * and a saved card (`pm_…`) per account but **no native Stripe subscription** —
 * WooCommerce Subscriptions owned the billing schedule. So continuity means
 * *creating* a native Stripe subscription on the platform's Pro price, billed
 * off the saved card, **anchored so the first platform charge lands on the
 * WooCommerce next-payment date** (a Stripe trial until then). No charge now, no
 * gap — provided the WooCommerce subscription is cancelled before that date so
 * the customer isn't billed twice.
 */

/** metadata.migratedFrom stamped on every subscription this creates, so a re-run
 * (and the customer.subscription.* webhook) can recognise its own work. */
export const BILLING_MIGRATION_TAG = "woocommerce";

/** How far in the future the anchor (trial end) must be for us to create the
 * subscription automatically. If the WooCommerce next-payment date is already
 * past — or within this window — we skip and leave it for a human, rather than
 * risk an immediate off-session charge the customer didn't expect. */
export const MIN_ANCHOR_LEAD_SECONDS = 3600;

export type BillingAction =
  | {
      kind: "create";
      /** Unix seconds; Stripe `trial_end` — first charge lands here. */
      trialEndUnix: number;
    }
  | { kind: "skip"; reason: string };

/** Seconds since the epoch for an ISO timestamp, or null if unparseable. */
export function toUnixSeconds(iso: string | null | undefined): number | null {
  if (!iso) {
    return null;
  }
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Decide what to do for one account, from the same export fields Phase 1 used.
 * Deliberately conservative: anything ambiguous or missing is a `skip` with a
 * human-readable reason (surfaced in the report), never a guessed charge.
 */
export function resolveBillingAction(
  input: {
    stripeCustomerId: string | null;
    stripePaymentMethodId: string | null;
    nextPaymentAt: string | null;
  },
  now: Date,
  minLeadSeconds: number = MIN_ANCHOR_LEAD_SECONDS,
): BillingAction {
  if (!input.stripeCustomerId) {
    return { kind: "skip", reason: "No Stripe customer (comp / manual-renewal account)" };
  }
  if (!input.stripePaymentMethodId) {
    return { kind: "skip", reason: "No saved payment method on file" };
  }
  const trialEndUnix = toUnixSeconds(input.nextPaymentAt);
  if (trialEndUnix === null) {
    return { kind: "skip", reason: "No next-payment date in the export" };
  }
  const nowUnix = Math.floor(now.getTime() / 1000);
  if (trialEndUnix <= nowUnix + minLeadSeconds) {
    return {
      kind: "skip",
      reason: `Next payment date (${input.nextPaymentAt}) is in the past or too soon — bill/handle manually`,
    };
  }
  return { kind: "create", trialEndUnix };
}

/** Shape of the Stripe subscription-create parameters this migration uses. A
 * structural subset of Stripe.SubscriptionCreateParams — kept explicit (and
 * Stripe-free) so it can be asserted in a unit test. */
export interface MigrationSubscriptionParams {
  customer: string;
  items: { price: string }[];
  default_payment_method: string;
  trial_end: number;
  /** Never prorate — the trial means there's nothing to prorate anyway. */
  proration_behavior: "none";
  /** When the trial ends with no usable card, cancel rather than leave an unpaid
   * subscription hanging. */
  trial_settings: { end_behavior: { missing_payment_method: "cancel" } };
  metadata: {
    accountId: string;
    planId: string;
    migratedFrom: string;
    wooSubscriptionId: string;
  };
}

/** Build the exact parameters for `stripe.subscriptions.create`. The webhook
 * (handleSubscriptionEvent) keys off `metadata.accountId`/`planId`, so both are
 * mandatory here. */
export function buildSubscriptionParams(input: {
  customer: string;
  priceId: string;
  paymentMethod: string;
  trialEndUnix: number;
  accountId: string;
  planId: string;
  wooSubscriptionId: string;
}): MigrationSubscriptionParams {
  return {
    customer: input.customer,
    items: [{ price: input.priceId }],
    default_payment_method: input.paymentMethod,
    trial_end: input.trialEndUnix,
    proration_behavior: "none",
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    metadata: {
      accountId: input.accountId,
      planId: input.planId,
      migratedFrom: BILLING_MIGRATION_TAG,
      wooSubscriptionId: input.wooSubscriptionId,
    },
  };
}
