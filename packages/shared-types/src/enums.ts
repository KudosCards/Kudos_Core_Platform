import { z } from "zod";

/**
 * These enums are the single source of truth for domain vocabulary.
 * The Prisma schema's enums must be kept in sync with these values by hand
 * (Prisma can't import from TS), so changing a value here always means
 * updating apps/api/prisma/schema.prisma in the same change.
 */

export const accountTypeSchema = z.enum(["organisation", "individual"]);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const membershipRoleSchema = z.enum(["owner", "admin", "staff"]);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const recipientStatusSchema = z.enum(["active", "lapsed", "archived"]);
export type RecipientStatus = z.infer<typeof recipientStatusSchema>;

export const occasionTypeSchema = z.enum([
  "birthday",
  "achievement",
  "leaver",
  "staff_recognition",
  "seasonal",
  "bespoke_campaign",
]);
export type OccasionType = z.infer<typeof occasionTypeSchema>;

export const occasionSourceSchema = z.enum(["recurring_per_recipient", "one_off_campaign"]);
export type OccasionSource = z.infer<typeof occasionSourceSchema>;

export const occasionStatusSchema = z.enum([
  "scheduled",
  "pending_approval",
  "approved",
  "queued",
  "printed",
  "posted",
  "delivered",
  "skipped",
]);
export type OccasionStatus = z.infer<typeof occasionStatusSchema>;

export const dispatchOptionSchema = z.enum(["asap", "auto_send"]);
export type DispatchOption = z.infer<typeof dispatchOptionSchema>;

export const postageClassSchema = z.enum(["first_class", "second_class"]);
export type PostageClass = z.infer<typeof postageClassSchema>;

export const orderRecipientStatusSchema = z.enum([
  "pending_approval",
  "approved",
  "queued",
  "printed",
  "posted",
  "delivered",
  "cancelled",
]);
export type OrderRecipientStatus = z.infer<typeof orderRecipientStatusSchema>;

export const walletEntryTypeSchema = z.enum(["topup", "charge", "refund", "adjustment"]);
export type WalletEntryType = z.infer<typeof walletEntryTypeSchema>;

export const subscriptionStatusSchema = z.enum([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const fulfillmentJobStatusSchema = z.enum([
  "pending",
  "in_progress",
  "printed",
  "posted",
  "delivered",
  "failed",
]);
export type FulfillmentJobStatus = z.infer<typeof fulfillmentJobStatusSchema>;
