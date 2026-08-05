import type { Occasion } from "@kudos/shared-types";

// The pure calendar-grid date maths now lives in @/lib/calendar-grid, shared
// with the ops dispatch calendar. Re-exported here so existing occasion-calendar
// imports keep their path. This file keeps only the occasion-specific helpers.
export {
  type CalendarView,
  ymdUTC,
  addDaysUTC,
  startOfDayUTC,
  startOfMonthUTC,
  mondayOnOrBefore,
  monthGridRange,
  weekRange,
  monthRange,
  listWindowRange,
  fetchRange,
  LIST_WINDOW_MONTHS,
} from "@/lib/calendar-grid";

import { ymdUTC } from "@/lib/calendar-grid";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
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
