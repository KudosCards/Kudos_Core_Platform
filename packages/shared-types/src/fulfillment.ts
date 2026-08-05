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
  /** Open cards (not yet posted) whose last Click & Drop import push failed — an
   * ops attention signal for the "must ship" band. See ADR 0111. */
  clickAndDropErrors: z.number(),
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

/**
 * One sampled card in the Click & Drop import-status readout: the reference we
 * stamp on the order (`ORD-<n>-<jobId8>`), plus Royal Mail's stored id or the
 * import error. An operator searches the dashboard for `orderReference` to
 * confirm our orders land in the right account. See ADR 0114.
 */
export const clickAndDropImportSampleSchema = z.object({
  jobId: z.string(),
  orderReference: z.string(),
  orderIdentifier: z.string().nullable(),
  error: z.string().nullable(),
  /** The precise import time (imported samples); null on error samples. */
  importedAt: z.coerce.date().nullable(),
  /** The row's last-changed time — used for error samples (last-failed). */
  updatedAt: z.coerce.date(),
});
export type ClickAndDropImportSample = z.infer<typeof clickAndDropImportSampleSchema>;

/**
 * GET /fulfillment/click-and-drop/import-status — where our fulfillment jobs
 * stand relative to Click & Drop. `imported`/`errored`/`awaiting` are disjoint
 * counts across every job; the sample arrays let an operator confirm real
 * references in the dashboard. `enabled` is false when no API key is set (the
 * counts still populate, so an awaiting backlog is visible before go-live).
 */
export const clickAndDropImportStatusSchema = z.object({
  enabled: z.boolean(),
  imported: z.number(),
  errored: z.number(),
  awaiting: z.number(),
  recentImports: z.array(clickAndDropImportSampleSchema),
  recentErrors: z.array(clickAndDropImportSampleSchema),
});
export type ClickAndDropImportStatus = z.infer<typeof clickAndDropImportStatusSchema>;

export interface FulfillmentProvider {
  submit(job: FulfillmentJob): Promise<{ providerReference: string }>;
  getStatus(providerReference: string): Promise<FulfillmentJobStatusUpdate>;
}

export interface FulfillmentJobStatusUpdate {
  status: z.infer<typeof fulfillmentJobStatusSchema>;
  occurredAt: Date;
}
