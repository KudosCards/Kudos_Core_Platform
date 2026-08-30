import { z } from "zod";
import { subscriptionStatusSchema, walletEntryTypeSchema } from "./enums";

/**
 * Recurring plan billing — a Stripe Subscription. Deliberately modelled
 * and processed separately from card-order billing (see WalletLedger /
 * BatchOrder) so the two never collapse into one cart/subscription object,
 * which is what caused the anomalies seen in the legacy WooCommerce system.
 */
export const subscriptionSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  planId: z.string(),
  stripeSubscriptionId: z.string(),
  status: subscriptionStatusSchema,
  currentPeriodEnd: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

/**
 * Statuses where the customer is, or should be, paying us. These entitle the
 * account and are what "has a subscription" means to the product.
 */
export const PAYING_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

/**
 * Not paid yet — but Stripe may still complete it on its own.
 *
 * `incomplete` is what a subscription becomes when its first payment needs
 * SCA/3DS. If the customer abandons the challenge it sits here, and their bank
 * can auto-complete the open invoice within Stripe's 23-hour window. It is
 * therefore not a dead row: it is a billing relationship that has not made up
 * its mind. See ADR 0190.
 */
export const SETTLING_SUBSCRIPTION_STATUSES = ["incomplete"] as const;

/**
 * Anything that could still result in money moving — paying now, or able to
 * start on its own.
 *
 * This is the set that must block a *second* subscription, and the set that must
 * be cancelled before an account is deleted. Using the paying set for either
 * question misses `incomplete`, which is precisely the status a half-finished
 * checkout leaves behind.
 */
export const CHARGEABLE_SUBSCRIPTION_STATUSES = [
  ...PAYING_SUBSCRIPTION_STATUSES,
  ...SETTLING_SUBSCRIPTION_STATUSES,
] as const;

export type ChargeableSubscriptionStatus = (typeof CHARGEABLE_SUBSCRIPTION_STATUSES)[number];

/** Narrowing helper for call sites holding a wider status (e.g. the Prisma
 * enum), so the chargeable set is asked rather than re-listed. */
export function isChargeableSubscriptionStatus(
  status: string,
): status is ChargeableSubscriptionStatus {
  return (CHARGEABLE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

export const walletLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  type: walletEntryTypeSchema,
  amountMinor: z.number().int(), // positive for topup/refund, negative for charge
  balanceAfterMinor: z.number().int(),
  reference: z.string().nullable(),
  /** Stripe hosted invoice page for a top-up ("view online"); null otherwise. */
  receiptUrl: z.string().nullable(),
  /** Stripe generated invoice PDF for a top-up (the downloadable VAT receipt). */
  receiptPdfUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type WalletLedgerEntry = z.infer<typeof walletLedgerEntrySchema>;

/**
 * Per-plan limits and feature gates, enforced centrally in the API rather
 * than scattered ad-hoc checks (e.g. the legacy "you can add 12 more
 * contacts" banner and the Pro-only auto-send gate).
 */
export const planEntitlementSchema = z.object({
  planId: z.string(),
  recipientCap: z.number().int().positive().nullable(), // null = unlimited
  batchOrderMaxSize: z.number().int().positive(),
  // Prisma's Decimal(5,2) column serialises to JSON as a string (Prisma.Decimal
  // has a toJSON() returning e.g. "10.00"), not a number — z.coerce handles
  // either shape rather than assuming the JS-side representation.
  cardDiscountPercent: z.coerce.number().min(0).max(100),
  autoSendEnabled: z.boolean(),
  /** Whether the plan may upload its own artwork as a custom card design. */
  customArtworkEnabled: z.boolean(),
  /** Whether the plan may invite additional team members (Centre-tier today). */
  teamSeatsEnabled: z.boolean(),
  /** Whether the plan may author reusable digital message pages (ADR 0132). */
  messagePagesEnabled: z.boolean(),
  /** Seats included in the plan's base price before per-seat charges (Centre 3). */
  includedSeats: z.number().int().nonnegative(),
  /** Null for the free plan, which has no Stripe subscription object at all. */
  stripePriceId: z.string().nullable(),
});
export type PlanEntitlement = z.infer<typeof planEntitlementSchema>;
