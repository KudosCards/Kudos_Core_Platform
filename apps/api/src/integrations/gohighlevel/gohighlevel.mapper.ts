import type { NormalizedContact } from "../../recipients/recipients.service";
import type { GoHighLevelContact } from "./gohighlevel-client";

/**
 * Which GoHighLevel field name feeds each of our fields. GoHighLevel's standard
 * contact fields are firstName / lastName / email / dateOfBirth and address1 /
 * city / postalCode / country. Configurable per connection so a location using
 * custom names can remap; only first + last name are required to import.
 */
export interface GoHighLevelFieldMapping {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth?: string;
  addressLine1?: string;
  addressCity?: string;
  addressPostcode?: string;
  addressCountry?: string;
}

export const DEFAULT_GOHIGHLEVEL_MAPPING: GoHighLevelFieldMapping = {
  firstName: "firstName",
  lastName: "lastName",
  email: "email",
  dateOfBirth: "dateOfBirth",
  addressLine1: "address1",
  addressCity: "city",
  addressPostcode: "postalCode",
  addressCountry: "country",
};

/** Reads a GoHighLevel field as a trimmed string, or null when absent/blank or
 * not a scalar. */
function field(contact: GoHighLevelContact, name: string | undefined): string | null {
  if (!name) {
    return null;
  }
  const value = contact[name];
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * Maps one GoHighLevel contact to our normalized shape, or null when it lacks the
 * required first/last name (a contact we can't address a card to). The GoHighLevel
 * contact id is the stable externalId the ingest funnel dedupes on.
 */
export function mapGoHighLevelContact(
  contact: GoHighLevelContact,
  mapping: GoHighLevelFieldMapping,
): NormalizedContact | null {
  const firstName = field(contact, mapping.firstName);
  const lastName = field(contact, mapping.lastName);
  if (!firstName || !lastName) {
    return null;
  }

  return {
    externalId: String(contact.id),
    firstName,
    lastName,
    email: field(contact, mapping.email),
    dateOfBirth: parseDate(field(contact, mapping.dateOfBirth)),
    addressLine1: field(contact, mapping.addressLine1),
    addressLine2: null,
    addressCity: field(contact, mapping.addressCity),
    addressPostcode: field(contact, mapping.addressPostcode),
    addressCountry: field(contact, mapping.addressCountry),
  };
}

/** GoHighLevel returns dateOfBirth as an ISO date/time string (e.g.
 * `1990-05-20T00:00:00.000Z`). Parse leniently; a bad/blank value becomes null. */
function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
