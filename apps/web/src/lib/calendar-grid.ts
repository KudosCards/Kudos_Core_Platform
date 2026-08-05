// Pure, data-agnostic calendar-grid date maths — shared by the customer
// occasions calendar (app/(app)/calendar) and the ops dispatch calendar
// (app/(ops)/fulfillment/calendar). All maths is done in UTC: calendar dates are
// stored at UTC midnight (they're days, not instants), so bucketing by UTC
// components keeps entries on the right square regardless of the viewer's
// timezone. See docs/adr/0110-dispatch-calendar.md.

export type CalendarView = "month" | "week" | "list";

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
  return {
    start,
    end: addDaysUTC(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1)), -1),
  };
}

/**
 * How many months the list view spans forward from its anchor month, so it
 * reads as a rolling "what's coming up" agenda across month boundaries rather
 * than one month at a time. Kept modest so a single fetch covers a realistic
 * window.
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

/** The date window to fetch for, given the current view + anchor. */
export function fetchRange(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === "month") return monthGridRange(anchor);
  if (view === "week") return weekRange(anchor);
  return listWindowRange(anchor);
}
