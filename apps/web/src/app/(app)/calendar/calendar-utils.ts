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

/** The date window to fetch occasions for, given the current view + anchor. */
export function fetchRange(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === "month") return monthGridRange(anchor);
  if (view === "week") return weekRange(anchor);
  return monthRange(anchor);
}

/** Which date an occasion sits on, honouring the "dispatch dates" toggle. */
export function occasionDay(occasion: Occasion, useDispatch: boolean): string {
  const value = useDispatch ? (occasion.dispatchDate ?? occasion.occasionDate) : occasion.occasionDate;
  return ymdUTC(new Date(value));
}

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
