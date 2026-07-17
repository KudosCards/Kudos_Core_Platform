import { z } from "zod";
import {
  dispatchOptionSchema,
  occasionSourceSchema,
  occasionStatusSchema,
  occasionTypeSchema,
  postageClassSchema,
} from "./enums";

export const occasionSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    /** Null for one_off_campaign occasions (e.g. an org-wide "Student of the Month" send). */
    recipientId: z.string().uuid().nullable(),
    type: occasionTypeSchema,
    source: occasionSourceSchema,
    /** The date the occasion itself falls on (e.g. the birthday), not the dispatch date. */
    occasionDate: z.coerce.date(),
    /** Computed: occasionDate minus the postage lead time for the chosen dispatch option. */
    dispatchDate: z.coerce.date().nullable(),
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
    recipient: z.object({ firstName: z.string(), lastName: z.string() }).nullable(),
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
