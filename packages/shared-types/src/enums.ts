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
  "renewal",
  "anniversary",
  "achievement",
  "leaver",
  "staff_recognition",
  "seasonal",
  "bespoke_campaign",
]);
export type OccasionType = z.infer<typeof occasionTypeSchema>;

/** The recurring occasion types generated automatically from a dated anchor —
 * birthdays from the DOB, renewals/anniversaries from a RecipientKeyDate. The
 * scheduler owns their lifecycle; they aren't hand-created like the others. */
export const RECURRING_OCCASION_TYPES = ["birthday", "renewal", "anniversary"] as const;

/** The subset of recurring types driven by a RecipientKeyDate (birthday comes
 * from Recipient.dateOfBirth instead). Mirrors the Prisma KeyDateType enum. */
export const keyDateTypeSchema = z.enum(["renewal", "anniversary"]);
export type KeyDateType = z.infer<typeof keyDateTypeSchema>;

export const occasionSourceSchema = z.enum([
  "recurring_per_recipient",
  "one_off_campaign",
  "shared_event",
]);
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
  /** The date came and went with no card sent. Distinct from `skipped`, which
   * is a person's decision — see docs/adr/0178. */
  "missed",
]);
export type OccasionStatus = z.infer<typeof occasionStatusSchema>;

/** Occasion statuses that are over: nothing more will happen to the card. */
export const CLOSED_OCCASION_STATUSES = ["delivered", "skipped", "missed"] as const;

/**
 * Statuses where no card was sent and none ever will be — the occasion was
 * abandoned, whether by the customer's decision (`skipped`) or by its date
 * going by (`missed`).
 *
 * Named because it is used as an exclusion, and an unnamed exclusion silently
 * widens every time a status is added: the ops "auto-send" count read
 * `status: { not: skipped }` and started counting missed occasions the moment
 * that value existed. A list with a name has to be looked at.
 */
export const ABANDONED_OCCASION_STATUSES = ["skipped", "missed"] as const;

/** Statuses where a card has been paid for and is in or through production, so
 * the occasion's date must never be moved out from under it. */
export const COMMITTED_OCCASION_STATUSES = ["queued", "printed", "posted", "delivered"] as const;

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
  "returned_to_sender",
  "cancelled",
]);
export type OrderRecipientStatus = z.infer<typeof orderRecipientStatusSchema>;

export const batchOrderStatusSchema = z.enum([
  "draft",
  "pending_payment",
  "paid",
  "fulfilling",
  "completed",
  "cancelled",
]);
export type BatchOrderStatus = z.infer<typeof batchOrderStatusSchema>;

export const paymentMethodSchema = z.enum(["card", "wallet"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

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
  "returned_to_sender",
  "failed",
]);
export type FulfillmentJobStatus = z.infer<typeof fulfillmentJobStatusSchema>;

/** Why Royal Mail returned a card (RTS). Mirrors the ReturnReason Prisma enum. */
export const returnReasonSchema = z.enum([
  "moved",
  "incomplete_address",
  "incorrect_address",
  "undeliverable",
  "other",
]);
export type ReturnReason = z.infer<typeof returnReasonSchema>;

/** The stage of a return case's recovery workflow. Mirrors ReturnCaseStatus. */
export const returnCaseStatusSchema = z.enum([
  "awaiting_address",
  "awaiting_resend",
  "resolved",
  "archived",
]);
export type ReturnCaseStatus = z.infer<typeof returnCaseStatusSchema>;

/** Whose turn it is on a support ticket. Mirrors SupportTicketStatus. */
export const supportTicketStatusSchema = z.enum([
  "open",
  "awaiting_customer",
  "resolved",
  "closed",
]);
export type SupportTicketStatus = z.infer<typeof supportTicketStatusSchema>;

/** Triage state of an Enterprise "Contact us" lead. Mirrors EnterpriseEnquiryStatus. */
export const enterpriseEnquiryStatusSchema = z.enum(["new", "in_progress", "closed"]);
export type EnterpriseEnquiryStatus = z.infer<typeof enterpriseEnquiryStatusSchema>;

/** The topic a subscriber picks when raising a ticket. Mirrors SupportTicketCategory. */
export const supportTicketCategorySchema = z.enum([
  "billing",
  "orders",
  "design",
  "account",
  "other",
]);
export type SupportTicketCategory = z.infer<typeof supportTicketCategorySchema>;

/** Support-set ticket urgency. Mirrors SupportTicketPriority. */
export const supportTicketPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type SupportTicketPriority = z.infer<typeof supportTicketPrioritySchema>;

/** Which side authored a support message. Mirrors SupportMessageAuthor. */
export const supportMessageAuthorSchema = z.enum(["customer", "support"]);
export type SupportMessageAuthor = z.infer<typeof supportMessageAuthorSchema>;

/** A support attachment's media kind. Mirrors SupportAttachmentKind. */
export const supportAttachmentKindSchema = z.enum(["image", "video"]);
export type SupportAttachmentKind = z.infer<typeof supportAttachmentKindSchema>;
