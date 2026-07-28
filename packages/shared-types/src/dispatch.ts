import type { PostageClass } from "./enums";

/**
 * Dispatch-date scheduling — how many *working* days before an occasion a card
 * must be posted to arrive on time.
 *
 * The old rule subtracted plain calendar days, so a card timed to land the day
 * before a birthday could be scheduled to post on a Sunday or a bank holiday
 * (when Kudos HQ doesn't print and Royal Mail doesn't collect) and arrive late.
 * This module counts backwards in *working* days — skipping weekends and UK
 * bank holidays — and adds extra lead during seasonal post-rush windows
 * (Christmas). It is pure and dependency-free so the API (which owns the
 * authoritative `dispatchDate`) and the web (First-Class nudges, previews)
 * compute it identically. See docs/adr/0056-working-day-dispatch.md.
 */

/** Default lead when no postage class is chosen yet (a fresh occasion, before
 * approval). */
export const DEFAULT_POSTAGE_LEAD_DAYS = 5;

/**
 * Working days before the occasion a card is posted, per postage class. First
 * class lands sooner, second class needs a longer run. These are Kudos HQ
 * print/pack turnaround plus Royal Mail delivery, counted as working days (so
 * the real calendar lead is longer, which is the point). The auto-send cron
 * acts once `dispatchDate <= today`. See docs/adr/0013-auto-send.md.
 */
export const POSTAGE_LEAD_DAYS: Record<PostageClass, number> = {
  first_class: 3,
  second_class: 5,
};

/**
 * England & Wales bank holidays, 2025–2028 (GOV.UK). Kept as a bundled
 * constant, not a live fetch: the list is fixed years ahead, and dispatch
 * timing must be deterministic and offline. Extend this when the horizon
 * approaches. ISO `YYYY-MM-DD`, UTC calendar dates.
 */
export const UK_BANK_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2025
  "2025-01-01", // New Year's Day
  "2025-04-18", // Good Friday
  "2025-04-21", // Easter Monday
  "2025-05-05", // Early May bank holiday
  "2025-05-26", // Spring bank holiday
  "2025-08-25", // Summer bank holiday
  "2025-12-25", // Christmas Day
  "2025-12-26", // Boxing Day
  // 2026
  "2026-01-01",
  "2026-04-03",
  "2026-04-06",
  "2026-05-04",
  "2026-05-25",
  "2026-08-31",
  "2026-12-25",
  "2026-12-28", // Boxing Day (substitute — 26 Dec is a Saturday)
  // 2027
  "2027-01-01",
  "2027-03-26",
  "2027-03-29",
  "2027-05-03",
  "2027-05-31",
  "2027-08-30",
  "2027-12-27", // Christmas Day (substitute — 25 Dec is a Saturday)
  "2027-12-28", // Boxing Day (substitute — 26 Dec is a Sunday)
  // 2028
  "2028-01-03", // New Year's Day (substitute — 1 Jan is a Saturday)
  "2028-04-14",
  "2028-04-17",
  "2028-05-01",
  "2028-05-29",
  "2028-08-28",
  "2028-12-25",
  "2028-12-26",
]);

/**
 * A seasonal window that changes how cards are dispatched — extra lead days for
 * the post rush, and optionally a nudge toward First Class. Matched on the
 * occasion's month/day (year-agnostic) so one rule covers every year.
 */
export interface SeasonalDispatchRule {
  /** Human label, shown in the First-Class nudge and recorded in audit. */
  label: string;
  /** Inclusive window start: month (1–12) and day (1–31). */
  from: { month: number; day: number };
  /** Inclusive window end. May be "earlier" than `from` to wrap over year-end. */
  to: { month: number; day: number };
  /** Extra working days of lead for occasions dated inside the window. */
  extraLeadDays: number;
  /** Whether to suggest First Class for occasions inside the window. */
  suggestFirstClass: boolean;
}

/**
 * Default seasonal rules. December is the Royal Mail post rush: cards need to go
 * earlier, and First Class is the safer bet. Seeded here as the sensible
 * default; a platform admin can override the set (see the service layer) without
 * a redeploy.
 */
export const SEASONAL_DISPATCH_RULES: readonly SeasonalDispatchRule[] = [
  {
    label: "Christmas post rush",
    from: { month: 12, day: 1 },
    to: { month: 12, day: 31 },
    extraLeadDays: 3,
    suggestFirstClass: true,
  },
];

/** Options for the dispatch calculation — injectable so admin-configured
 * holiday/seasonal sets can override the bundled defaults. */
export interface DispatchDateOptions {
  holidays?: ReadonlySet<string>;
  seasonalRules?: readonly SeasonalDispatchRule[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO `YYYY-MM-DD` for a date's UTC calendar day. */
export function isoDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** UTC midnight of a date — dispatch maths is all date-only. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** True when a card can be printed and posted on this date: a weekday that
 * isn't a bank holiday. */
export function isWorkingDay(date: Date, holidays: ReadonlySet<string> = UK_BANK_HOLIDAYS): boolean {
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false; // Sunday / Saturday
  return !holidays.has(isoDay(date));
}

/** Comparable month/day key (month*100 + day) for year-agnostic windowing. */
function monthDayKey(month: number, day: number): number {
  return month * 100 + day;
}

/** The first seasonal rule whose window contains this occasion date, or null. */
export function seasonalDispatchRuleFor(
  occasionDate: Date,
  rules: readonly SeasonalDispatchRule[] = SEASONAL_DISPATCH_RULES,
): SeasonalDispatchRule | null {
  const cur = monthDayKey(occasionDate.getUTCMonth() + 1, occasionDate.getUTCDate());
  for (const rule of rules) {
    const lo = monthDayKey(rule.from.month, rule.from.day);
    const hi = monthDayKey(rule.to.month, rule.to.day);
    const inWindow = lo <= hi ? cur >= lo && cur <= hi : cur >= lo || cur <= hi;
    if (inWindow) return rule;
  }
  return null;
}

/**
 * The dispatch date for an occasion: `leadDays` working days before the
 * occasion (skipping weekends and bank holidays), plus any seasonal extra lead.
 * The returned date is always itself a working day, so a card is never
 * scheduled to post on a day nothing ships.
 */
export function computeDispatchDate(
  occasionDate: Date,
  leadDays: number = DEFAULT_POSTAGE_LEAD_DAYS,
  options: DispatchDateOptions = {},
): Date {
  const holidays = options.holidays ?? UK_BANK_HOLIDAYS;
  const rule = seasonalDispatchRuleFor(occasionDate, options.seasonalRules);
  let remaining = leadDays + (rule?.extraLeadDays ?? 0);

  const dispatch = startOfUtcDay(occasionDate);
  while (remaining > 0) {
    dispatch.setUTCDate(dispatch.getUTCDate() - 1);
    if (isWorkingDay(dispatch, holidays)) remaining--;
  }
  return dispatch;
}

/** Whether to nudge the sender toward First Class for this occasion, and why. */
export interface FirstClassSuggestion {
  suggested: boolean;
  reason?: string;
}

/**
 * Should we suggest First Class for a card timed to this occasion? True inside a
 * seasonal window flagged `suggestFirstClass` (the Christmas post rush), so the
 * UI can prompt "Royal Mail is slower now — consider First Class" at the point
 * postage is chosen.
 */
export function suggestFirstClass(
  occasionDate: Date,
  options: { seasonalRules?: readonly SeasonalDispatchRule[] } = {},
): FirstClassSuggestion {
  const rule = seasonalDispatchRuleFor(occasionDate, options.seasonalRules);
  if (rule?.suggestFirstClass) {
    return {
      suggested: true,
      reason: `${rule.label}: Royal Mail is slower now — First Class helps it arrive on time.`,
    };
  }
  return { suggested: false };
}
