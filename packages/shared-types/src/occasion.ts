import { z } from "zod";
import {
  type BatchOrderStatus,
  batchOrderStatusSchema,
  dispatchOptionSchema,
  type OccasionStatus,
  occasionSourceSchema,
  occasionStatusSchema,
  occasionTypeSchema,
  postageClassSchema,
} from "./enums";

/** Batch-order statuses that mean the customer has actually paid. */
export const PAID_BATCH_ORDER_STATUSES = [
  "paid",
  "fulfilling",
  "completed",
] as const satisfies readonly BatchOrderStatus[];

/**
 * Whether an occasion's card has genuinely been sent — i.e. paid for and in or
 * through fulfilment. **Order-aware on purpose.** An occasion enters `queued` at
 * checkout, *before* payment, and stays `queued` all the way through settlement
 * (settlement never re-touches occasion status), so `queued` alone cannot tell a
 * paid card apart from one where the customer clicked Send but never paid. It
 * therefore counts as sent only when its order is actually paid. `printed` /
 * `posted` / `delivered` are only ever reached after settlement, so they always
 * count. This is the single source of truth for "sent" across the calendar and
 * events views — it replaced three drifting copies that keyed off occasion
 * status alone and so showed an abandoned unpaid order as "Sent". See ADR 0141.
 */
export function isOccasionSent(
  status: OccasionStatus,
  orderStatus?: BatchOrderStatus | null,
): boolean {
  if (status === "printed" || status === "posted" || status === "delivered") {
    return true;
  }
  if (status === "queued") {
    return (
      orderStatus != null && (PAID_BATCH_ORDER_STATUSES as readonly string[]).includes(orderStatus)
    );
  }
  return false;
}

export type OccasionProgress = "upcoming" | "sent" | "skipped";

/**
 * The calendar's three-way progress for an occasion. `skipped` is terminal;
 * otherwise it's `sent` (paid + in/through fulfilment, see isOccasionSent) or
 * `upcoming`. Order-aware — pass the linked order's status.
 */
export function occasionProgress(
  status: OccasionStatus,
  orderStatus?: BatchOrderStatus | null,
): OccasionProgress {
  if (status === "skipped") {
    return "skipped";
  }
  return isOccasionSent(status, orderStatus) ? "sent" : "upcoming";
}

/**
 * The batch order an occasion was sent on, nested onto the occasion so the
 * calendar/recipient views can link straight through to it ("follow this
 * card's order"). Null/absent until the occasion has been checked out into an
 * order. Derived from OrderRecipient.occasionId server-side. See ADR 0055.
 */
export const occasionOrderLinkSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.number().int(),
  status: batchOrderStatusSchema,
});
export type OccasionOrderLink = z.infer<typeof occasionOrderLinkSchema>;

export const occasionSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    /** Null for one_off_campaign occasions (e.g. an org-wide "Student of the Month" send). */
    recipientId: z.string().uuid().nullable(),
    type: occasionTypeSchema,
    source: occasionSourceSchema,
    /** Human label for a hand-added recipient event ("Graduation", "End of exams");
     * null for auto-scheduled birthdays and campaign occasions. */
    title: z.string().nullable(),
    /** The date the occasion itself falls on (e.g. the birthday), not the dispatch date. */
    occasionDate: z.coerce.date(),
    /** Computed: occasionDate minus the postage lead time for the chosen dispatch option. */
    dispatchDate: z.coerce.date().nullable(),
    /** True when a human dragged the dispatch date to a specific day, so the
     * working-day recompute leaves it alone. Optional so endpoints that don't
     * select it still parse. See docs/adr/0058-drag-dispatch.md. */
    dispatchDateOverridden: z.boolean().optional(),
    status: occasionStatusSchema,
    /** Set by POST /occasions/:id/approve; copied into OrderRecipient.savedDesignId at checkout. */
    savedDesignId: z.string().uuid().nullable(),
    /** `auto_send` occasions are ordered, paid (wallet), and posted by the cron; `asap` are checked out by hand. */
    dispatchOption: dispatchOptionSchema,
    /** Postage class for auto_send timing + stamp cost; irrelevant for asap occasions. */
    postageClass: postageClassSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    // OccasionsService always nests the recipient's display name — every
    // real response includes this, not just occasions with a recipientId.
    recipient: z
      .object({
        firstName: z.string(),
        lastName: z.string(),
        /** The contact's stored postal address, so checkout can pre-fill the
         * shipping line instead of asking for it again (it's already on the
         * record). Optional — occasion endpoints that don't select the address
         * still parse. See ADR 0119. */
        addressLine1: z.string().nullable().optional(),
        addressLine2: z.string().nullable().optional(),
        addressCity: z.string().nullable().optional(),
        addressPostcode: z.string().nullable().optional(),
        /** True when a card to this contact was returned and the address hasn't
         * been re-verified — checkout warns before sending again. Optional so
         * occasion endpoints that don't select it still parse. See ADR 0039. */
        addressVerificationRequired: z.boolean().optional(),
      })
      .nullable(),
    /** The order this occasion was sent on, when it has been checked out — lets
     * the UI link to its order history. Optional so endpoints that don't select
     * it still parse; null once ordered-then-cleared is impossible, so absent =
     * not yet ordered. See ADR 0055. */
    order: occasionOrderLinkSchema.nullable().optional(),
  })
  .refine((o) => o.source !== "recurring_per_recipient" || o.recipientId !== null, {
    message: "recurring_per_recipient occasions must have a recipientId",
    path: ["recipientId"],
  });
export type Occasion = z.infer<typeof occasionSchema>;

/**
 * Matches CreateOccasionDto exactly. No `source` field — OccasionsService
 * always hardcodes `source: "one_off_campaign"` server-side; recurring
 * occasions only ever come from the birthday scheduler, never this endpoint.
 */
export const createOccasionInputSchema = z.object({
  recipientId: z.string().uuid().optional(),
  type: occasionTypeSchema,
  occasionDate: z.coerce.date(),
});
export type CreateOccasionInput = z.infer<typeof createOccasionInputSchema>;

/**
 * Matches CreateRecipientEventDto. Adds a hand-curated event (graduation, end
 * of exams, …) to a recipient; the API creates it as a `scheduled` occasion —
 * on the calendar immediately, out of the approvals queue until the subscriber
 * prepares a card for it.
 */
export const createRecipientEventInputSchema = z.object({
  recipientId: z.string().uuid(),
  type: occasionTypeSchema,
  title: z.string().max(120).optional(),
  occasionDate: z.coerce.date(),
});
export type CreateRecipientEventInput = z.infer<typeof createRecipientEventInputSchema>;

/**
 * Matches ApproveOccasionDto. dispatchOption defaults to `asap` (manual
 * checkout); `auto_send` opts the card into the hands-off cron (order, wallet
 * payment, timed dispatch) and requires the plan's autoSendEnabled entitlement
 * plus a complete recipient postal address — both enforced server-side.
 * postageClass only matters for `auto_send` (it drives the stamp cost and the
 * dispatch lead time).
 */
export const approveOccasionInputSchema = z.object({
  savedDesignId: z.string().uuid(),
  dispatchOption: dispatchOptionSchema.optional(),
  postageClass: postageClassSchema.optional(),
});
export type ApproveOccasionInput = z.infer<typeof approveOccasionInputSchema>;
