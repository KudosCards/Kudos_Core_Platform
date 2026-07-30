import type { Occasion } from "@kudos/shared-types";

export type CalendarView = "month" | "week" | "list";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

// All calendar date maths is done in UTC. Occasion dates are stored at UTC
// midnight (they're calendar dates, not instants), so bucketing days by their
// UTC components keeps occasions on the right square regardless of the viewer's
// timezone.

export function ymdUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function addDaysUTC(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Monday of the ISO week containing `d` (weeks start Monday, UK convention). */
export function mondayOnOrBefore(d: Date): Date {
  const x = startOfDayUTC(d);
  const isoDow = (x.getUTCDay() + 6) % 7; // 0 = Monday
  return addDaysUTC(x, -isoDow);
}

/** The 6-week (42-day) grid that renders a month, starting on a Monday. */
export function monthGridRange(anchor: Date): { start: Date; end: Date } {
  const start = mondayOnOrBefore(startOfMonthUTC(anchor));
  return { start, end: addDaysUTC(start, 41) };
}

export function weekRange(anchor: Date): { start: Date; end: Date } {
  const start = mondayOnOrBefore(anchor);
  return { start, end: addDaysUTC(start, 6) };
}

export function monthRange(anchor: Date): { start: Date; end: Date } {
  const start = startOfMonthUTC(anchor);
  return { start, end: addDaysUTC(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1)), -1) };
}

/**
 * How many months the list view spans forward from its anchor month, so it
 * reads as a rolling "what's coming up" agenda across month boundaries rather
 * than one month at a time. Kept modest so a single fetch (perPage 100) covers
 * a realistic account's occasions.
 */
export const LIST_WINDOW_MONTHS = 3;

/**
 * The forward window the list view fetches and groups: from the start of the
 * anchor's month through the last day of the (LIST_WINDOW_MONTHS-1)th following
 * month. Anchored to whole months so the month sub-headers line up cleanly.
 */
export function listWindowRange(anchor: Date): { start: Date; end: Date } {
  const start = startOfMonthUTC(anchor);
  const end = addDaysUTC(
    new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + LIST_WINDOW_MONTHS, 1)),
    -1,
  );
  return { start, end };
}

/** The date window to fetch occasions for, given the current view + anchor. */
export function fetchRange(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === "month") return monthGridRange(anchor);
  if (view === "week") return weekRange(anchor);
  return listWindowRange(anchor);
}

/** Which date an occasion sits on, honouring the "dispatch dates" toggle. */
export function occasionDay(occasion: Occasion, useDispatch: boolean): string {
  const value = useDispatch ? (occasion.dispatchDate ?? occasion.occasionDate) : occasion.occasionDate;
  return ymdUTC(new Date(value));
}

/**
 * An occasion's lifecycle stage, collapsed to what the calendar needs to show:
 * whether the card has already gone out. Status advances scheduled →
 * pending_approval → approved → queued → printed → posted → delivered as the
 * card is checked out and fulfilled, so anything queued-or-later has been sent.
 */
export type OccasionProgress = "upcoming" | "sent" | "skipped";

const SENT_STATUSES = new Set(["queued", "printed", "posted", "delivered"]);

export function occasionProgress(status: string): OccasionProgress {
  if (status === "skipped") return "skipped";
  return SENT_STATUSES.has(status) ? "sent" : "upcoming";
}

/** Pill styling for a card that's already been sent — a "done" green with a
 * tick, so a sent birthday reads instantly differently from an upcoming one. */
export const OCCASION_SENT_COLOR = "bg-emerald-600 text-white border-emerald-700";

/** Pill styling for a skipped occasion — muted and struck through. */
export const OCCASION_SKIPPED_COLOR =
  "bg-foreground/[0.04] text-muted border-border line-through";

/** Colour per occasion type — a coloured pill on the grid. */
export const OCCASION_TYPE_COLORS: Record<string, string> = {
  birthday: "bg-amber-100 text-amber-800 border-amber-200",
  achievement: "bg-emerald-100 text-emerald-800 border-emerald-200",
  leaver: "bg-sky-100 text-sky-800 border-sky-200",
  staff_recognition: "bg-violet-100 text-violet-800 border-violet-200",
  seasonal: "bg-rose-100 text-rose-800 border-rose-200",
  bespoke_campaign: "bg-slate-100 text-slate-700 border-slate-200",
};

export const OCCASION_TYPES = [
  "birthday",
  "achievement",
  "leaver",
  "staff_recognition",
  "seasonal",
  "bespoke_campaign",
] as const;
