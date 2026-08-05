import { z } from "zod";
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
 * Working days before the occasion a card is posted, per postage class. Kudos
 * HQ's operating rule is a single **send-by-5** SLA: every ordered card is
 * posted at least 5 working days before its delivery date, regardless of postage
 * class, so the print/post schedule has one deadline to work to and nothing
 * arrives late (see docs/adr/0115-send-by-5-dispatch-assurance.md). The values
 * are equal by design — kept as a per-class map so a class could be given a
 * longer run later without touching call sites. The auto-send cron acts once
 * `dispatchDate <= today`. See docs/adr/0013-auto-send.md.
 */
export const POSTAGE_LEAD_DAYS: Record<PostageClass, number> = {
  first_class: 5,
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
 * Bundled default seasonal rules. December is the Royal Mail post rush: cards
 * need to go earlier, and First Class is the safer bet. This is the fallback the
 * engine uses until a platform admin overrides the set at runtime (see
 * `setSeasonalDispatchRules` + the API's DispatchConfigService) — no redeploy.
 */
export const DEFAULT_SEASONAL_DISPATCH_RULES: readonly SeasonalDispatchRule[] = [
  {
    label: "Christmas post rush",
    from: { month: 12, day: 1 },
    to: { month: 12, day: 31 },
    extraLeadDays: 3,
    suggestFirstClass: true,
  },
];

/**
 * The active rule set the engine uses when a caller doesn't pass its own.
 * Process-wide, mutable, and seeded with the bundled default — the API loads the
 * admin-configured set into it on boot and whenever it changes, so
 * `computeDispatchDate`/`suggestFirstClass` honour it with no per-call plumbing.
 * The web never sets it, so it keeps the sensible default there.
 */
let activeSeasonalRules: readonly SeasonalDispatchRule[] = DEFAULT_SEASONAL_DISPATCH_RULES;

/** Replace the active seasonal rule set (admin config). Pass the default to
 * reset. Callers can still override per-call via the `options` argument. */
export function setSeasonalDispatchRules(rules: readonly SeasonalDispatchRule[]): void {
  activeSeasonalRules = rules;
}

/** The active seasonal rule set the engine is currently using. */
export function getSeasonalDispatchRules(): readonly SeasonalDispatchRule[] {
  return activeSeasonalRules;
}

/**
 * @deprecated Use `DEFAULT_SEASONAL_DISPATCH_RULES` (the immutable default) or
 * `getSeasonalDispatchRules()` (the active, possibly admin-configured set). Kept
 * as an alias for the default so existing imports don't break.
 */
export const SEASONAL_DISPATCH_RULES = DEFAULT_SEASONAL_DISPATCH_RULES;

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
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Step `n` working days forward from `from` (or backward when `n` is negative),
 * skipping weekends and bank holidays. Returns UTC midnight of the landing day.
 * `n === 0` returns the same calendar day (never snapped to a working day).
 * The forward counterpart of computeDispatchDate's backward count — used to turn
 * "5 working days from today" into a concrete calendar cutoff. See ADR 0108.
 */
export function addWorkingDays(
  from: Date,
  n: number,
  holidays: ReadonlySet<string> = UK_BANK_HOLIDAYS,
): Date {
  const cursor = startOfUtcDay(from);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + step);
    if (isWorkingDay(cursor, holidays)) remaining--;
  }
  return cursor;
}

/**
 * Signed count of working days from `from` to `target`: 0 when they're the same
 * calendar day, positive when `target` is ahead, negative when it's behind.
 * Only working days are counted, so a `target` that is itself a weekend/holiday
 * is reached but not tallied (dispatch dates are always working days, so this is
 * a defensive edge, not the norm). Drives the queue's "due in N working days"
 * badge — computed server-side because only the server holds the holiday set.
 */
export function workingDaysUntil(
  target: Date,
  from: Date,
  holidays: ReadonlySet<string> = UK_BANK_HOLIDAYS,
): number {
  const end = startOfUtcDay(target);
  const cursor = startOfUtcDay(from);
  if (cursor.getTime() === end.getTime()) return 0;
  const step = end.getTime() > cursor.getTime() ? 1 : -1;
  let count = 0;
  while (cursor.getTime() !== end.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + step);
    if (isWorkingDay(cursor, holidays)) count += step;
  }
  return count;
}

/** True when a card can be printed and posted on this date: a weekday that
 * isn't a bank holiday. */
export function isWorkingDay(
  date: Date,
  holidays: ReadonlySet<string> = UK_BANK_HOLIDAYS,
): boolean {
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
  rules: readonly SeasonalDispatchRule[] = activeSeasonalRules,
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

/** Validation for an admin-supplied seasonal rule (matches SeasonalDispatchRule).
 * Bounds keep a bad edit from setting an absurd lead or an unbounded rule list. */
export const seasonalDispatchRuleSchema = z.object({
  label: z.string().trim().min(1).max(80),
  from: z.object({
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
  to: z.object({
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
  extraLeadDays: z.number().int().min(0).max(30),
  suggestFirstClass: z.boolean(),
});

/** The full admin-editable rule set — bounded so it can't grow unbounded. */
export const seasonalDispatchRulesSchema = z.array(seasonalDispatchRuleSchema).max(24);
export type SeasonalDispatchRuleInput = z.infer<typeof seasonalDispatchRuleSchema>;

/**
 * Runtime knobs for the send-by-5 ops dispatch reminder (ADR 0115/0117) — editable
 * by ops with no redeploy. `leadWorkingDays` is the must-ship window (the SLA,
 * default 5); `escalateAfterWorkingDays` is how many working days past its deadline
 * a card must be before it escalates to super admins (0 = escalation off).
 */
export const dispatchReminderConfigSchema = z.object({
  /** Whether the daily reminder runs at all. */
  enabled: z.boolean(),
  /** UTC hour (0–23) the weekday digest is sent. */
  sendHourUtc: z.number().int().min(0).max(23),
  /** The send-by window in working days — the must-ship horizon. */
  leadWorkingDays: z.number().int().min(1).max(15),
  /** Overdue-by threshold (working days) that escalates a card to super admins;
   * 0 disables escalation. */
  escalateAfterWorkingDays: z.number().int().min(0).max(15),
});
export type DispatchReminderConfig = z.infer<typeof dispatchReminderConfigSchema>;

/** The out-of-the-box reminder config: on, 07:00 UTC, send-by-5, escalate at 3 wd late. */
export const DEFAULT_DISPATCH_REMINDER_CONFIG: DispatchReminderConfig = {
  enabled: true,
  sendHourUtc: 7,
  leadWorkingDays: 5,
  escalateAfterWorkingDays: 3,
};
