/**
 * How close an approved card is to the day it must be posted.
 *
 * An approved card carrying `dispatchOption: "asap"` is waiting for somebody to
 * place and pay for an order. Nothing chases it: the auto-send cron only ever
 * acts on `auto_send`, and once the occasion date passes the nightly sweep
 * retires the card as `missed`. So the card is lost quietly, and the only thing
 * that would have prevented it is somebody noticing the posting date coming.
 *
 * This is what lets the screen say which ones are running out, rather than
 * listing eight dates and leaving the arithmetic to the reader. See
 * docs/click-and-forget-capture-recon.md.
 */

/** Inside this many days, ordering stops being something to get round to. */
export const ORDER_SOON_DAYS = 3;

export type OrderUrgency =
  /** The posting date has gone. The card can no longer arrive on time. */
  | { level: "passed"; days: number }
  /** Today, or within ORDER_SOON_DAYS. */
  | { level: "soon"; days: number }
  /** Far enough out to leave. */
  | { level: "later"; days: number };

/**
 * Whole days from `today` to `dispatchDate`, both `YYYY-MM-DD`.
 *
 * Compared as UTC calendar days rather than timestamps. A dispatch date is a
 * `@db.Date` with no time in it, and subtracting `Date.now()` from midnight
 * makes "today" read as ‑1 for most of the working day — which would show every
 * card due today as already missed.
 */
function daysBetween(today: string, dispatchDate: string): number {
  const from = Date.parse(`${today}T00:00:00.000Z`);
  const to = Date.parse(`${dispatchDate}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Null when there is no dispatch date to judge, or either date is unreadable —
 * the row still renders, it just says nothing it cannot support.
 */
export function orderUrgency(
  dispatchDate: string | Date | null | undefined,
  today: string,
): OrderUrgency | null {
  if (!dispatchDate) return null;
  // The API serialises a date column as a full ISO timestamp; only the calendar
  // day is meaningful.
  const iso = (typeof dispatchDate === "string" ? dispatchDate : dispatchDate.toISOString()).slice(
    0,
    10,
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;

  const days = daysBetween(today, iso);
  if (!Number.isFinite(days)) return null;
  if (days < 0) return { level: "passed", days: -days };
  if (days <= ORDER_SOON_DAYS) return { level: "soon", days };
  return { level: "later", days };
}

/** One line an operator can act on, rather than a date to work out. */
export function orderUrgencyLabel(urgency: OrderUrgency): string {
  if (urgency.level === "passed") {
    return urgency.days === 1
      ? "Should have posted yesterday"
      : `Should have posted ${urgency.days} days ago`;
  }
  if (urgency.days === 0) return "Must post today";
  return urgency.days === 1 ? "Must post tomorrow" : `Must post in ${urgency.days} days`;
}
