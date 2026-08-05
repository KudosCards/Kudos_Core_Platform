import { addWorkingDays, startOfUtcDay, workingDaysUntil } from "@kudos/shared-types";

/**
 * The "due soon" window: a card whose dispatch deadline falls within this many
 * working days of today is what the print/post team works next. Matches the
 * standard second-class lead (docs/adr/0056) — a card due inside one send cycle.
 * A module constant for now; a future DispatchConfigService knob could make it
 * per-season. See docs/adr/0108-dispatch-date-queue.md.
 */
export const DUE_SOON_WORKING_DAYS = 5;

/** Which urgency bucket a card's dispatch deadline falls in. */
export type DueBucket = "overdue" | "today" | "due_soon" | "upcoming" | "no_date";

/**
 * The two concrete calendar dates that partition the queue by urgency, computed
 * once per request from the working-day engine so the DB filter is a plain
 * indexed range scan on `due_date` — never working-day arithmetic in SQL.
 * `today` is UTC midnight; `dueSoon` is DUE_SOON_WORKING_DAYS working days ahead.
 */
export interface DueCutoffs {
  today: Date;
  dueSoon: Date;
}

export function dueCutoffs(
  now: Date = new Date(),
  leadWorkingDays: number = DUE_SOON_WORKING_DAYS,
): DueCutoffs {
  const today = startOfUtcDay(now);
  return { today, dueSoon: addWorkingDays(today, leadWorkingDays) };
}

/**
 * Working days until a card must post: negative = overdue, 0 = due today,
 * positive = still ahead. Null when the card has no dated deadline (no occasion).
 * Computed server-side because only the server holds the UK holiday calendar.
 */
export function workingDaysUntilDue(dueDate: Date | null, now: Date = new Date()): number | null {
  if (!dueDate) return null;
  return workingDaysUntil(dueDate, now);
}

/** Parse a `YYYY-MM-DD` calendar date to its UTC-midnight Date, for comparing
 * against the `@db.Date` dueDate column. */
export function isoDayToUtc(iso: string): Date {
  const [y, m, d] = iso.split("-");
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}
