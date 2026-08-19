/**
 * Europe/London time, in one place.
 *
 * The platform's scheduling model is UTC days and that's right: a posting
 * deadline shouldn't move because the clocks did. But some things are judged by
 * a person's clock, not the server's — the same-day posting cut-off ("ordered
 * before 3pm"), the hour an operator's morning email lands, and what "yesterday"
 * means in a report a UK business reads. Those need UK local time, and half the
 * year that's an hour off UTC.
 *
 * `Intl` already carries the whole Europe/London DST history, so there is no
 * offset table here to get wrong and no dependency to add. Lives in shared-types
 * because both the API and the web need it.
 */

const LONDON = "Europe/London";

/** The London-local calendar parts of an instant. */
export function londonParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  let hour = get("hour");
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  return { year: get("year"), month: get("month"), day: get("day"), hour };
}

/** The London-local hour (0–23) at an instant — "is it 7am in the UK yet?". */
export function londonHour(date: Date): number {
  return londonParts(date).hour;
}

/** The London calendar day containing `at`, as `YYYY-MM-DD`. */
export function londonDay(at: Date): string {
  // en-CA formats as YYYY-MM-DD, which is also how we store and show it.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

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

/**
 * The UTC instant at which a London calendar day begins.
 *
 * Guess UTC midnight, then correct by London's offset *at that guess*. One
 * correction is enough because the transitions happen at 01:00/02:00 local, so
 * the offset at 00:00 UTC is always the one that applies at London midnight —
 * checked against both DST transitions.
 */
export function londonDayStart(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  if (year === undefined || month === undefined || date === undefined || Number.isNaN(date)) {
    // Only ever fed londonDay()'s output today, but a silent Invalid Date here
    // would surface as an empty report rather than as an error.
    throw new Error(`londonDayStart expects a YYYY-MM-DD day, got "${day}"`);
  }
  const guess = new Date(Date.UTC(year, month - 1, date));
  return new Date(guess.getTime() - londonOffsetMinutes(guess) * 60_000);
}

/**
 * The last complete London day before `now`, as the day itself plus the
 * half-open UTC window `[from, to)` covering it.
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
