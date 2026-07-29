import { z } from "zod";
import { ukDateRegex } from "@kudos/shared-types";
import { UK_POSTCODE_REGEX } from "../common/uk-postcode";

/** Matches the legacy CSV import contract: dd/mm/yyyy only. */
export function parseUkDate(value: string): Date {
  const match = ukDateRegex.exec(value.trim());
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
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressPostcode: string | null;
  email: string | null;
}

export function parseRecipientRow(row: Record<string, string>): ParsedRecipientRow {
  const firstName = row.firstName?.trim();
  const lastName = row.lastName?.trim();
  if (!firstName) throw new Error("firstName is required");
  if (!lastName) throw new Error("lastName is required");

  const dateOfBirth = row.dateOfBirth?.trim() ? parseUkDate(row.dateOfBirth) : null;

  // Full postal address so imported contacts can actually be mailed. Kept
  // permissive (import-and-flag): a row without an address still imports and is
  // surfaced as "needs address" rather than rejected — a bulk source is never
  // silently dropped. A postcode, when given, must still be a valid UK one.
  const addressLine1 = row.addressLine1?.trim();
  const addressLine2 = row.addressLine2?.trim();
  const addressCity = row.addressCity?.trim();
  const postcode = row.postcode?.trim();
  if (postcode && !UK_POSTCODE_REGEX.test(postcode)) {
    throw new Error(`"${postcode}" is not a valid UK postcode`);
  }

  // Same rule as the JSON API (class-validator's @IsEmail) and @kudos/shared-types'
  // recipientSchema (zod's .email()) — previously a separate, more permissive regex
  // let malformed addresses (e.g. "a@b@example.com") into the DB via CSV that the
  // JSON create/update endpoint would reject.
  const email = row.email?.trim();
  if (email && !z.string().email().safeParse(email).success) {
    throw new Error(`"${email}" is not a valid email address`);
  }

  return {
    firstName,
    lastName,
    dateOfBirth,
    addressLine1: addressLine1 || null,
    addressLine2: addressLine2 || null,
    addressCity: addressCity || null,
    addressPostcode: postcode || null,
    email: email || null,
  };
}
