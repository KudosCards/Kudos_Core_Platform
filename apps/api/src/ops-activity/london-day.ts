/**
 * London calendar days, as UTC instants.
 *
 * The platform works in UTC days everywhere else (dispatch dates, occasion
 * dates, `startOfUtcDay`) and that's right for scheduling: a posting deadline
 * shouldn't move because the clocks did. The ops digest is different. It's a
 * report a person in the UK reads over coffee, and "yesterday" has to mean the
 * day they'd call yesterday. Half the year those are the same thing; from late
 * March to late October they're an hour apart, so an order placed at 00:30 BST
 * would land in the wrong day's email.
 *
 * No date library: the repo has none, and `Intl` already knows the whole
 * Europe/London DST history, which is the only hard part.
 */

const LONDON = "Europe/London";

/** London's offset from UTC in minutes at a moment — 0 in GMT, +60 in BST. */
function londonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) {
    // "GMT" with no offset — i.e. exactly UTC.
    return 0;
  }
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

/** The London calendar day containing `at`, as `YYYY-MM-DD`. */
export function londonDay(at: Date): string {
  // en-CA formats as YYYY-MM-DD, which is also what we want to store and show.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * The UTC instant at which a London calendar day begins.
 *
 * Guess UTC midnight, then correct by London's offset *at that guess*. One
 * correction is enough because the transitions happen at 01:00/02:00 local, so
 * the offset at 00:00 UTC is always the offset that applies at London midnight
 * — checked against both 2026 transitions.
 */
export function londonDayStart(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  if (year === undefined || month === undefined || date === undefined || Number.isNaN(date)) {
    // Only ever fed londonDay()'s output today, but a silent Invalid Date here
    // would surface as an empty digest rather than as an error.
    throw new Error(`londonDayStart expects a YYYY-MM-DD day, got "${day}"`);
  }
  const guess = new Date(Date.UTC(year, month - 1, date));
  return new Date(guess.getTime() - londonOffsetMinutes(guess) * 60_000);
}

/**
 * The last complete London day before `now`, as the day itself plus the
 * half-open UTC window `[from, to)` that covers it.
 *
 * Derived by stepping back one millisecond from the start of today rather than
 * subtracting 24 hours, so the clocks-back day (which really is 25 hours long)
 * comes out whole rather than an hour short.
 */
export function previousLondonDay(now: Date): { day: string; from: Date; to: Date } {
  const to = londonDayStart(londonDay(now));
  const day = londonDay(new Date(to.getTime() - 1));
  return { day, from: londonDayStart(day), to };
}
