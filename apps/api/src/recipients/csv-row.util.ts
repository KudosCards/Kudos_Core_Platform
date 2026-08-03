import { z } from "zod";
import { ukDateRegex } from "@kudos/shared-types";
import { UK_POSTCODE_REGEX } from "../common/uk-postcode";

/** Build a UTC date and reject impossible calendar dates (e.g. 31 April). */
function toUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Matches the legacy CSV import contract: dd/mm/yyyy only. Kept strict (and
 * throwing) because it documents that canonical contract; the CSV row parser
 * uses the lenient `parseFlexibleDate` below so a differently-formatted export
 * doesn't get its whole row rejected. */
export function parseUkDate(value: string): Date {
  const match = ukDateRegex.exec(value.trim());
  if (!match) {
    throw new Error(`Expected dd/mm/yyyy, got "${value}"`);
  }
  const [, day, month, year] = match as unknown as [string, string, string, string];
  const date = toUtcDate(Number(year), Number(month), Number(day));
  if (!date) {
    throw new Error(`"${value}" is not a real calendar date`);
  }
  return date;
}

const UK_DASH_DATE_REGEX = /^(\d{2})-(\d{2})-(\d{4})$/; // dd-mm-yyyy
const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/; // yyyy-mm-dd

/**
 * Lenient date parse for CSV import. Accepts the UK `dd/mm/yyyy` (primary), its
 * dashed variant `dd-mm-yyyy`, and unambiguous ISO `yyyy-mm-dd` — the formats
 * real-world contact exports actually use. Returns `null` for anything else (or
 * an impossible calendar date) so the caller can import the contact *without* a
 * date of birth rather than reject the whole row. Ambiguous US `mm/dd/yyyy` is
 * deliberately not guessed — this is a UK product and a wrong guess is worse
 * than no date.
 */
export function parseFlexibleDate(value: string): Date | null {
  const trimmed = value.trim();
  // dd/mm/yyyy and dd-mm-yyyy: groups are day, month, year.
  let match = ukDateRegex.exec(trimmed) ?? UK_DASH_DATE_REGEX.exec(trimmed);
  if (match) return toUtcDate(Number(match[3]), Number(match[2]), Number(match[1]));
  // ISO yyyy-mm-dd: groups are year, month, day.
  match = ISO_DATE_REGEX.exec(trimmed);
  if (match) return toUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
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

export interface ParsedRecipientRowResult {
  parsed: ParsedRecipientRow;
  /** Non-fatal notes: an optional field that was present but couldn't be used,
   * so the contact was imported without it (rather than the row being dropped). */
  warnings: string[];
}

/**
 * Parse one CSV row into a recipient. Only first/last name are truly required —
 * everything else follows the import-and-flag rule: a present-but-malformed
 * *optional* field (date of birth, postcode, email) is dropped with a warning
 * and the contact still imports, instead of the whole row being rejected. A
 * single wrong-format column (e.g. birthdays exported as yyyy-mm-dd) used to
 * silently reject an entire file — see docs/adr/0082-csv-import-lenient-fields.md.
 */
export function parseRecipientRow(row: Record<string, string>): ParsedRecipientRowResult {
  const warnings: string[] = [];

  const firstName = row.firstName?.trim();
  const lastName = row.lastName?.trim();
  if (!firstName) throw new Error("firstName is required");
  if (!lastName) throw new Error("lastName is required");

  let dateOfBirth: Date | null = null;
  const dobRaw = row.dateOfBirth?.trim();
  if (dobRaw) {
    dateOfBirth = parseFlexibleDate(dobRaw);
    if (!dateOfBirth) {
      warnings.push(`Date of birth "${dobRaw}" wasn't recognised (use dd/mm/yyyy) — imported without it`);
    }
  }

  const addressLine1 = row.addressLine1?.trim();
  const addressLine2 = row.addressLine2?.trim();
  const addressCity = row.addressCity?.trim();

  // A given postcode must be a valid UK one to be stored — but an invalid one no
  // longer rejects the contact; it's dropped with a warning (and the row is
  // flagged "needs address" downstream like any other missing-address import).
  let addressPostcode: string | null = null;
  const postcode = row.postcode?.trim();
  if (postcode) {
    if (UK_POSTCODE_REGEX.test(postcode)) {
      addressPostcode = postcode;
    } else {
      warnings.push(`Postcode "${postcode}" isn't a valid UK postcode — imported without it`);
    }
  }

  // Same rule as the JSON API (zod's .email()); a malformed address is dropped
  // with a warning rather than rejecting the whole contact.
  let email: string | null = null;
  const emailRaw = row.email?.trim();
  if (emailRaw) {
    if (z.string().email().safeParse(emailRaw).success) {
      email = emailRaw;
    } else {
      warnings.push(`Email "${emailRaw}" isn't a valid email address — imported without it`);
    }
  }

  return {
    parsed: {
      firstName,
      lastName,
      dateOfBirth,
      addressLine1: addressLine1 || null,
      addressLine2: addressLine2 || null,
      addressCity: addressCity || null,
      addressPostcode,
      email,
    },
    warnings,
  };
}
