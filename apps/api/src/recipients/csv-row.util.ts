const UK_DATE_REGEX = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

/** Matches the legacy CSV import contract: dd/mm/yyyy only. */
export function parseUkDate(value: string): Date {
  const match = UK_DATE_REGEX.exec(value.trim());
  if (!match) {
    throw new Error(`Expected dd/mm/yyyy, got "${value}"`);
  }
  const [, day, month, year] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error(`"${value}" is not a real calendar date`);
  }
  return date;
}

export interface ParsedRecipientRow {
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  addressPostcode: string | null;
  email: string | null;
}

export function parseRecipientRow(row: Record<string, string>): ParsedRecipientRow {
  const firstName = row.firstName?.trim();
  const lastName = row.lastName?.trim();
  if (!firstName) throw new Error("firstName is required");
  if (!lastName) throw new Error("lastName is required");

  const dateOfBirth = row.dateOfBirth?.trim() ? parseUkDate(row.dateOfBirth) : null;

  const postcode = row.postcode?.trim();
  if (postcode && !UK_POSTCODE_REGEX.test(postcode)) {
    throw new Error(`"${postcode}" is not a valid UK postcode`);
  }

  const email = row.email?.trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error(`"${email}" is not a valid email address`);
  }

  return {
    firstName,
    lastName,
    dateOfBirth,
    addressPostcode: postcode || null,
    email: email || null,
  };
}
