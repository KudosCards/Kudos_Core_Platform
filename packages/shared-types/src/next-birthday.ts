import { startOfUtcDay } from "./dispatch";

/**
 * Next occurrence of `anchor`'s month/day on or after `from` (inclusive — a
 * birthday today counts as due today, not pushed to next year). A date of
 * 29 February lands on 28 February in non-leap years, the conventional choice
 * for a date that does not exist most years.
 *
 * Lives here rather than in the API because the Contacts list needs the same
 * answer, and computing it separately got a different one: local-time getters
 * on a UTC value and `new Date(year, 1, 29)`, which JavaScript rolls over to
 * 1 March. The list said 1 March all year while the card was scheduled for
 * 28 February. Same reasoning as the dispatch maths in `dispatch.ts` — the API
 * owns the authoritative value, and the web must not disagree about what it
 * would be. See ADR 0204 and ADR 0056.
 *
 * All arithmetic is UTC: a `@db.Date` column arrives as UTC midnight, and
 * local-time getters read the day before it west of Greenwich.
 */
export function nextBirthdayOccurrence(anchor: Date, from: Date): Date {
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();
  const isFeb29 = month === 1 && day === 29;
  const today = startOfUtcDay(from);

  let candidate = buildAnniversary(today.getUTCFullYear(), month, day, isFeb29);
  if (candidate < today) {
    candidate = buildAnniversary(today.getUTCFullYear() + 1, month, day, isFeb29);
  }
  return candidate;
}

function buildAnniversary(year: number, month: number, day: number, isFeb29: boolean): Date {
  if (isFeb29 && !isLeapYear(year)) {
    return new Date(Date.UTC(year, 1, 28));
  }
  return new Date(Date.UTC(year, month, day));
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
