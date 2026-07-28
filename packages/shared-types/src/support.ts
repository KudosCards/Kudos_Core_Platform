import { z } from "zod";
import {
  supportMessageAuthorSchema,
  supportTicketCategorySchema,
  supportTicketPrioritySchema,
  supportTicketStatusSchema,
} from "./enums";

/**
 * Two-way support ticketing — the contract between the API and both web
 * surfaces (the subscriber's account area and the ops /admin portal). A
 * subscriber raises a ticket; the Kudos support team replies from ops; the
 * thread goes back and forth until it's resolved/closed. Support-only internal
 * notes are never included in the customer-facing views. See
 * docs/adr/0066-support-ticketing.md.
 */

/** One message in a ticket thread. `internalNote` is only ever true in the ops
 * views — it is stripped from every customer-facing payload. */
export const supportMessageSchema = z.object({
  id: z.string().uuid(),
  authorType: supportMessageAuthorSchema,
  body: z.string(),
  internalNote: z.boolean(),
  createdAt: z.coerce.date(),
});
export type SupportMessage = z.infer<typeof supportMessageSchema>;

/** A ticket row for a list (no thread). Shared shape for both sides. */
export const supportTicketSummarySchema = z.object({
  id: z.string().uuid(),
  /** Human reference, rendered as TKT-1000. */
  ticketNumber: z.number().int(),
  subject: z.string(),
  category: supportTicketCategorySchema,
  priority: supportTicketPrioritySchema,
  status: supportTicketStatusSchema,
  /** Denormalised most-recent-activity time + which side sent it ("whose turn"). */
  lastMessageAt: z.coerce.date(),
  lastMessageFrom: supportMessageAuthorSchema,
  createdAt: z.coerce.date(),
});
export type SupportTicketSummary = z.infer<typeof supportTicketSummarySchema>;

/** A ticket plus its full thread — the subscriber's detail view. */
export const supportTicketDetailSchema = supportTicketSummarySchema.extend({
  messages: z.array(supportMessageSchema),
});
export type SupportTicketDetail = z.infer<typeof supportTicketDetailSchema>;

/** The ops queue row — the subscriber view plus the account/business identity
 * and the assigned operator (if any). */
export const supportTicketOpsSummarySchema = supportTicketSummarySchema.extend({
  accountId: z.string().uuid(),
  businessName: z.string(),
  /** Email of the operator handling it, or null when unassigned. */
  assignee: z.string().nullable(),
});
export type SupportTicketOpsSummary = z.infer<typeof supportTicketOpsSummarySchema>;

/** The ops detail view — the full thread (including internal notes) + assignee. */
export const supportTicketOpsDetailSchema = supportTicketOpsSummarySchema.extend({
  messages: z.array(supportMessageSchema),
});
export type SupportTicketOpsDetail = z.infer<typeof supportTicketOpsDetailSchema>;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Raise a ticket: subject + category + the first message. */
export const createSupportTicketSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  category: supportTicketCategorySchema.default("other"),
  message: z.string().trim().min(1).max(5000),
});
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

/** A subscriber's reply on their own ticket. */
export const supportReplySchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type SupportReplyInput = z.infer<typeof supportReplySchema>;

/** An operator's reply — optionally an internal (support-only) note. */
export const supportOpsReplySchema = z.object({
  body: z.string().trim().min(1).max(5000),
  internalNote: z.boolean().default(false),
});
export type SupportOpsReplyInput = z.infer<typeof supportOpsReplySchema>;

/** Ops ticket management: change status/priority and (un)assign to self. */
export const updateSupportTicketSchema = z
  .object({
    status: supportTicketStatusSchema.optional(),
    priority: supportTicketPrioritySchema.optional(),
    /** "me" claims the ticket for the acting operator; "none" unassigns. */
    assign: z.enum(["me", "none"]).optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined || v.assign !== undefined, {
    message: "Provide at least one of status, priority or assign",
  });
export type UpdateSupportTicketInput = z.infer<typeof updateSupportTicketSchema>;
