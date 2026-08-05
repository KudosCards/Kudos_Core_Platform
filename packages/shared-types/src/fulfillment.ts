import { z } from "zod";
import { fulfillmentJobStatusSchema } from "./enums";

/**
 * v1 fulfillment is an internal ops queue (manual print/post). This shape
 * is intentionally provider-agnostic so a real print-API vendor (e.g.
 * Stannp, Cloudprinter) can be plugged in later without changing callers.
 */
export const fulfillmentJobSchema = z.object({
  id: z.string().uuid(),
  orderRecipientId: z.string().uuid(),
  status: fulfillmentJobStatusSchema,
  assignedToUserId: z.string().uuid().nullable(),
  printedAt: z.coerce.date().nullable(),
  postedAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),
  trackingReference: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type FulfillmentJob = z.infer<typeof fulfillmentJobSchema>;

/** Urgency filter over a job's dispatch deadline, and the queue sort key.
 * The ops queue's spine — see docs/adr/0108-dispatch-date-queue.md. */
export const DUE_FILTERS = ["overdue", "today", "due_soon", "upcoming", "no_date", "all"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export const QUEUE_SORTS = ["due_date", "created_at"] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];

/**
 * The queue's counts payload: per-status across every status, plus the due-date
 * urgency buckets computed within the actionable `pending` queue. `dueSoon`
 * counts cards due within the working-day window (excluding today and overdue,
 * which have their own buckets). Drives the ops filter chips.
 */
export const fulfillmentCountsSchema = z.object({
  status: z.record(fulfillmentJobStatusSchema, z.number()),
  due: z.object({
    overdue: z.number(),
    today: z.number(),
    dueSoon: z.number(),
    upcoming: z.number(),
    noDate: z.number(),
  }),
});
export type FulfillmentCounts = z.infer<typeof fulfillmentCountsSchema>;

/**
 * One day's posting workload on the dispatch calendar: how many still-open cards
 * (pending / in progress / printed — not yet posted) are due to post that day.
 * `day` is a `YYYY-MM-DD` calendar date. See docs/adr/0110-dispatch-calendar.md.
 */
export const fulfillmentCalendarDaySchema = z.object({
  day: z.string(),
  total: z.number(),
  pending: z.number(),
  inProgress: z.number(),
  printed: z.number(),
});
export type FulfillmentCalendarDay = z.infer<typeof fulfillmentCalendarDaySchema>;

/**
 * GET /fulfillment/calendar — the open posting workload keyed on dispatch
 * deadline. `days` holds only days that have cards (the grid fills the gaps);
 * `overdueBefore` is the count of still-open cards whose deadline fell before the
 * requested window, for a "carried in" banner.
 */
export const fulfillmentCalendarSchema = z.object({
  days: z.array(fulfillmentCalendarDaySchema),
  overdueBefore: z.number(),
});
export type FulfillmentCalendar = z.infer<typeof fulfillmentCalendarSchema>;

export interface FulfillmentProvider {
  submit(job: FulfillmentJob): Promise<{ providerReference: string }>;
  getStatus(providerReference: string): Promise<FulfillmentJobStatusUpdate>;
}

export interface FulfillmentJobStatusUpdate {
  status: z.infer<typeof fulfillmentJobStatusSchema>;
  occurredAt: Date;
}
