import { z } from "zod";
import { fulfillmentJobStatusSchema } from "./enums";
import type { FulfillmentJobStatus } from "./enums";

/**
 * A card that has not been posted yet, so its dispatch deadline is still a live
 * question.
 *
 * One definition, shared, because the same three statuses were written out in
 * four places — the API's queue and counts, the ops order cockpit, the queue's
 * filter chips and once as a bare literal inside a row — and four copies of a
 * rule is how they drift. They already had: the queue's due-date chips counted
 * `pending` alone while the send-by-5 banner directly above them and the
 * dispatch calendar beside them counted all three, so an operator with five
 * printed cards due today read "Due today 0" under a banner saying "5 cards to
 * post today". See ADR 0108 §5.
 */
/**
 * Every fulfilment status, in the order the print/post team works them — which
 * is also the order the queue's tabs appear in.
 *
 * One list, because the queue had two: the client rendered a tab per status
 * while the server page validated the `status` query param against a
 * hand-written six that omitted `returned_to_sender`. An operator saw
 * "returned to sender 7", clicked it, and silently landed on Pending. See
 * ADR 0202.
 */
export const FULFILLMENT_STATUSES = fulfillmentJobStatusSchema.options;

export const OPEN_FULFILLMENT_STATUSES = [
  "pending",
  "in_progress",
  "printed",
] as const satisfies readonly FulfillmentJobStatus[];

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
 * urgency buckets computed across every still-open card — `pending`,
 * `in_progress` and `printed` — because a printed card that has not been posted
 * still has a deadline to meet. `dueSoon` counts cards due within the
 * working-day window (excluding today and overdue, which have their own
 * buckets). Drives the ops filter chips. See ADR 0108 §5.
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

/**
 * One card on the send-by-5 must-ship watch-list (ADR 0115): identify + prioritise
 * it (name + city, as the queue already exposes — no street address).
 * `workingDaysUntilDue` is negative when overdue, 0 when due today.
 */
export const mustShipCardSchema = z.object({
  jobId: z.string(),
  orderNumber: z.number(),
  recipientName: z.string(),
  city: z.string(),
  postcode: z.string(),
  dueDate: z.coerce.date(),
  workingDaysUntilDue: z.number(),
  status: fulfillmentJobStatusSchema,
});
export type MustShipCard = z.infer<typeof mustShipCardSchema>;

/**
 * GET /fulfillment/must-ship — the send-by-5 watch-list. `overdue`/`today`/
 * `dueSoon` are disjoint counts of open (not-yet-posted) cards by dispatch
 * deadline; `total` is their sum; `cards` holds the most urgent (soonest first),
 * bounded. See docs/adr/0115-send-by-5-dispatch-assurance.md.
 */
export const mustShipSummarySchema = z.object({
  overdue: z.number(),
  today: z.number(),
  dueSoon: z.number(),
  total: z.number(),
  cards: z.array(mustShipCardSchema),
});
export type MustShipSummary = z.infer<typeof mustShipSummarySchema>;

export interface FulfillmentProvider {
  submit(job: FulfillmentJob): Promise<{ providerReference: string }>;
  getStatus(providerReference: string): Promise<FulfillmentJobStatusUpdate>;
}

export interface FulfillmentJobStatusUpdate {
  status: z.infer<typeof fulfillmentJobStatusSchema>;
  occurredAt: Date;
}
