import { z } from "zod";
import { occasionTypeSchema, returnCaseStatusSchema, returnReasonSchema } from "./enums";
import { ukPostcodeRegex } from "./recipient";

/**
 * Returned to Sender (RTS) service recovery — the contract between the API and
 * the web app for the return-case workflow. See docs/adr/0039-returned-to-sender.md.
 */

/** Whether an in-time resend to the recipient is still possible. */
export const resendEligibilitySchema = z.object({
  /** The contact has a complete enough address on file to resend to. */
  hasRecipientAddress: z.boolean(),
  /** The occasion date has passed by more than the configured window. */
  birthdayPassed: z.boolean(),
  /** Whole days since the occasion date (negative if upcoming; null when the
   * returned card had no dated occasion). */
  daysSinceOccasion: z.number().int().nullable(),
});
export type ResendEligibility = z.infer<typeof resendEligibilitySchema>;

/** The customer-facing view of one return case. */
export const returnCaseSchema = z.object({
  id: z.string().uuid(),
  /** The original (returned) order's human number, rendered as ORD-####. */
  orderNumber: z.number().int(),
  recipientId: z.string().uuid(),
  recipientName: z.string(),
  occasionType: occasionTypeSchema.nullable(),
  occasionTitle: z.string().nullable(),
  occasionDate: z.coerce.date().nullable(),
  reason: returnReasonSchema,
  status: returnCaseStatusSchema,
  /** The one Kudos Promise free recovery — true once used. */
  freeRecoveryUsed: z.boolean(),
  addressUpdatedAt: z.coerce.date().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  /** "resend_recipient" | "send_business" | "archived" | null (still open). */
  resolution: z.string().nullable(),
  returnedAt: z.coerce.date(),
  resend: resendEligibilitySchema,
});
export type ReturnCase = z.infer<typeof returnCaseSchema>;

/** One row of the ops RTS queue (no street address — data minimisation). */
export const rtsQueueItemSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  businessName: z.string(),
  recipientName: z.string(),
  occasionType: occasionTypeSchema.nullable(),
  occasionDate: z.coerce.date().nullable(),
  reason: returnReasonSchema,
  status: returnCaseStatusSchema,
  freeRecoveryUsed: z.boolean(),
  returnedAt: z.coerce.date(),
  daysSinceReturn: z.number().int(),
  awaitingAddress: z.boolean(),
  awaitingResend: z.boolean(),
  archived: z.boolean(),
});
export type RtsQueueItem = z.infer<typeof rtsQueueItemSchema>;

/** Body for POST /admin/returns — ops marks a card returned. */
export const markReturnedInputSchema = z.object({
  fulfillmentJobId: z.string().uuid(),
  reason: returnReasonSchema,
});
export type MarkReturnedInput = z.infer<typeof markReturnedInputSchema>;

/** Body for the address-carrying recovery actions (update address / send to
 * business): a UK postal address. */
export const recoveryAddressInputSchema = z.object({
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  addressCity: z.string().min(1).max(120),
  addressPostcode: z.string().regex(ukPostcodeRegex, "Must be a valid UK postcode"),
  addressCountry: z.string().max(2).optional(),
});
export type RecoveryAddressInput = z.infer<typeof recoveryAddressInputSchema>;
