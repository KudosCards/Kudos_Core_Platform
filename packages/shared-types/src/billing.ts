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

export const walletLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  type: walletEntryTypeSchema,
  amountMinor: z.number().int(), // positive for topup/refund, negative for charge
  balanceAfterMinor: z.number().int(),
  reference: z.string().nullable(),
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
  /** Null for the free plan, which has no Stripe subscription object at all. */
  stripePriceId: z.string().nullable(),
});
export type PlanEntitlement = z.infer<typeof planEntitlementSchema>;
