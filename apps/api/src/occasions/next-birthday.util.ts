/**
 * Next occurrence of dateOfBirth's month/day on or after `from` (inclusive —
 * a birthday today counts as due today, not pushed to next year). A
 * recipient born on 29 Feb lands on 28 Feb in non-leap years, the
 * conventional choice for a date that doesn't exist most years.
 */
export function nextBirthdayOccurrence(dateOfBirth: Date, from: Date): Date {
  const month = dateOfBirth.getUTCMonth();
  const day = dateOfBirth.getUTCDate();
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

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
