import { z } from "zod";
import { occasionOrderLinkSchema } from "./occasion";
import {
  dispatchOptionSchema,
  occasionStatusSchema,
  occasionTypeSchema,
  postageClassSchema,
} from "./enums";

/**
 * A shared event: one card design sent to a curated cohort of contacts on the
 * same date (End of Year, Results Day, a Christmas send). The Event owns the
 * title/type/date; each attached contact is a member Occasion, so the calendar,
 * approvals, and checkout all reuse the occasion pipeline while the calendar
 * collapses members into one entry. See docs/adr/0057-shared-events.md.
 */

/** One attached contact's member occasion — the detail-view row. */
export const eventMemberSchema = z.object({
  occasionId: z.string().uuid(),
  recipientId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  status: occasionStatusSchema,
  dispatchDate: z.coerce.date().nullable(),
  /** True when a card to this contact was returned and the address needs a
   * re-check before sending again. See ADR 0039. */
  addressVerificationRequired: z.boolean().optional(),
  /** The order this member was sent on, once checked out. */
  order: occasionOrderLinkSchema.nullable().optional(),
});
export type EventMember = z.infer<typeof eventMemberSchema>;

/** Calendar/list row: the event plus rollup counts (no member detail). */
export const eventSummarySchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  title: z.string().min(1).max(120),
  type: occasionTypeSchema,
  eventDate: z.coerce.date(),
  notes: z.string().nullable(),
  /** Total attached contacts. */
  memberCount: z.number().int().nonnegative(),
  /** Members whose card has already gone out (queued-or-later). Lets the
   * calendar show "3 of 10 sent" without pulling every member. */
  sentCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type EventSummary = z.infer<typeof eventSummarySchema>;

/** Detail view: the summary plus every member occasion. */
export const eventWithMembersSchema = eventSummarySchema.extend({
  members: z.array(eventMemberSchema),
});
export type EventWithMembers = z.infer<typeof eventWithMembersSchema>;

/** Matches CreateEventDto — a new event and its initial cohort. */
export const createEventInputSchema = z.object({
  title: z.string().min(1).max(120),
  type: occasionTypeSchema,
  eventDate: z.coerce.date(),
  notes: z.string().max(500).optional(),
  recipientIds: z.array(z.string().uuid()).min(1).max(1000),
});
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

/** Matches UpdateEventDto — edit the event's own fields (not its membership). */
export const updateEventInputSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    type: occasionTypeSchema.optional(),
    eventDate: z.coerce.date().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;

/** Matches AddEventMembersDto — attach more contacts to the cohort. */
export const addEventMembersInputSchema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1).max(1000),
});
export type AddEventMembersInput = z.infer<typeof addEventMembersInputSchema>;

/**
 * Matches OrderEventDto — send the whole cohort: pick one design (and postage),
 * and every still-unsent member is approved with it and checked out together.
 * dispatchOption/postageClass mirror the per-occasion approval semantics.
 */
export const orderEventInputSchema = z.object({
  savedDesignId: z.string().uuid(),
  dispatchOption: dispatchOptionSchema.optional(),
  postageClass: postageClassSchema.optional(),
});
export type OrderEventInput = z.infer<typeof orderEventInputSchema>;
