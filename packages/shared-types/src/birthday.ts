/**
 * Birthdays whose year nobody knows.
 *
 * Most sources give a full date of birth. CleanCloud does not: it captures
 * `birthdayDay` and `birthdayMonth` at sign-up and never asks for a year. That
 * is enough to send a birthday card — `nextBirthdayOccurrence` reads only the
 * month and day — but `Recipient.dateOfBirth` is a `DateTime`, so something has
 * to go in the year.
 *
 * The rule here is: store a placeholder, and record separately that it IS a
 * placeholder. The alternative — inferring "no year" from a magic year value —
 * was rejected twice over. A magic year outside the plausible range (1600) is
 * rejected by the API's own `MinDate` bound, so the contact could be imported
 * but never edited; a magic year inside it (2000) is indistinguishable from a
 * real 26-year-old, so we would hide the true birth year of every customer who
 * happens to have one. `Recipient.birthYearKnown` carries the fact explicitly
 * instead, and this year becomes an implementation detail.
 */

/**
 * The year stored when only a day and month are known.
 *
 * Two constraints, both load-bearing:
 *
 * - **A leap year.** 29 February is a real birthday. In a non-leap placeholder
 *   year `Date.UTC(year, 1, 29)` rolls silently into 1 March, and the customer
 *   gets their card on the wrong day.
 * - **Inside the API's 120-year plausibility window** (`MAX_AGE_YEARS`), which
 *   bounds `dateOfBirth` on every create and update. A placeholder outside it
 *   imports fine and then fails the moment anyone opens the contact and saves.
 *
 * It is never shown to anyone: every display path checks `birthYearKnown`.
 */
export const BIRTHDAY_PLACEHOLDER_YEAR = 2000;

/**
 * A day and month with no year, as the UTC date the database stores.
 *
 * Returns null for anything that is not a real calendar date — month 13, day
 * 31 of February, a zero either side. Round-tripped through the `Date` rather
 * than range-checked by hand, because JavaScript's overflow is the whole
 * hazard: `Date.UTC(2000, 1, 31)` is 2 March, not an error.
 */
export function birthdayWithoutYear(day: number, month: number): Date | null {
  if (!Number.isInteger(day) || !Number.isInteger(month)) {
    return null;
  }
  const date = new Date(Date.UTC(BIRTHDAY_PLACEHOLDER_YEAR, month - 1, day));
  if (
    date.getUTCFullYear() !== BIRTHDAY_PLACEHOLDER_YEAR ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** How a birthday is written: "14 March 1985" or "14/03/1985". */
export type BirthDateStyle = "long" | "short";

/**
 * A date of birth as it should appear on screen and in exports.
 *
 * When the year is not known, the year is simply absent — "14 March", "14/03"
 * — rather than replaced by a plausible-looking lie. All arithmetic is UTC: a
 * `@db.Date` column arrives as UTC midnight, and local-time getters read the
 * day before it west of Greenwich (the same trap `nextBirthdayOccurrence`
 * documents).
 */
export function formatBirthDate(
  value: Date | string,
  yearKnown: boolean,
  style: BirthDateStyle = "short",
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const options: Intl.DateTimeFormatOptions =
    style === "long"
      ? { day: "numeric", month: "long", timeZone: "UTC" }
      : { day: "2-digit", month: "2-digit", timeZone: "UTC" };
  if (yearKnown) {
    options.year = "numeric";
  }
  return date.toLocaleDateString("en-GB", options);
}
