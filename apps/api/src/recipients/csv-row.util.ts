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
    addressPostcode: postcode || null,
    email: email || null,
  };
}
