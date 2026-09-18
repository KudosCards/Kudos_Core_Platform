import { birthdayWithoutYear, externalContactSchema } from "@kudos/shared-types";
import type { NormalizedContact } from "../../recipients/recipients.service";
import type { CleanCloudCustomer } from "./cleancloud-client";
import { parseAddress } from "./parse-address";

/**
 * One CleanCloud customer as a Kudos contact.
 *
 * CleanCloud needs no field mapping, unlike Brevo or HubSpot: its fields are
 * fixed by the product rather than named by each account, so there is nothing
 * for a customer to configure and no mapping UI to build.
 *
 * Three of its fields do not match ours, and each is handled here:
 *   - one `customerName` where we need a first and a last name;
 *   - one free-text `customerAddress` where we need four columns;
 *   - a birthday with a day and a month but no year.
 *
 * See ADR 0252.
 */

/** Column limits from `recipientSchema`. */
const NAME_LIMIT = 120;

export function mapCleanCloudCustomer(customer: CleanCloudCustomer): NormalizedContact | null {
  const externalId = readId(customer.customerID);
  if (!externalId) {
    return null;
  }

  const name = splitCustomerName(customer.customerName);
  if (!name) {
    return null;
  }

  const address = parseAddress(customer.customerAddress);
  const birthday = readBirthday(customer.birthdayDay, customer.birthdayMonth);

  return {
    externalId,
    firstName: name.firstName,
    lastName: name.lastName,
    email: readEmail(customer.customerEmail),
    dateOfBirth: birthday,
    // CleanCloud never asks for a birth year, so a birthday from here always
    // carries a placeholder one. With no birthday there is no year to qualify,
    // and the flag is left at its default. See birthday.ts.
    ...(birthday !== null && { birthYearKnown: false }),
    ...address,
    addressCountry: null,
  };
}

/**
 * The single name field as a first and a last name.
 *
 * Split on the LAST whitespace, so the surname is the final token and
 * everything before it is the given name(s): "Mary Anne Clarke" → "Mary Anne" /
 * "Clarke". The same rule `deriveContactName` uses on our own signup field.
 *
 * A name with no whitespace — a mononym, or a business trading name in the
 * customer field — returns null, and the sync counts it as `unmappable` where
 * the customer can see it. The alternatives were considered and are worse: a
 * card addressed "Dear Yusuf Yusuf", or a placeholder surname printed on an
 * envelope. A contact we cannot address is better not sent than sent wrong.
 */
export function splitCustomerName(
  raw: string | null | undefined,
): { firstName: string; lastName: string } | null {
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const lastSpace = cleaned.lastIndexOf(" ");
  if (lastSpace === -1) {
    return null;
  }
  const firstName = cleaned.slice(0, lastSpace).slice(0, NAME_LIMIT);
  const lastName = cleaned.slice(lastSpace + 1).slice(0, NAME_LIMIT);
  return { firstName, lastName };
}

/**
 * The birthday, or null when CleanCloud holds none.
 *
 * `birthdayWithoutYear` rejects a day and month that are not a real calendar
 * date, which is doing more work than it looks: JavaScript rolls 31 February
 * forward into March rather than refusing it, and a contact whose birthday
 * quietly moved is one who gets their card on the wrong day.
 */
function readBirthday(
  day: string | number | null | undefined,
  month: string | number | null | undefined,
): Date | null {
  const d = readInt(day);
  const m = readInt(month);
  if (d === null || m === null) {
    return null;
  }
  return birthdayWithoutYear(d, m);
}

/** CleanCloud's examples carry ids and numbers as both numbers and strings, so
 * both are read — but only a string of digits, never a parseInt of "12 High
 * Street". */
function readInt(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return null;
  }
  return Number(value.trim());
}

function readId(value: string | number | null | undefined): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  return value.trim() || null;
}

/**
 * An email address, or null.
 *
 * Validated against the wire contract's own rule rather than a regex of our
 * own. A malformed address stored on a recipient does not fail here — it fails
 * later, when the web parses that contact back out of the API and the whole
 * contacts list refuses to render.
 */
function readEmail(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }
  return externalContactSchema.shape.email.safeParse(trimmed).success ? trimmed : null;
}
