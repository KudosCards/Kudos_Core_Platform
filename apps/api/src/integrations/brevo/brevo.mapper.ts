import type { NormalizedContact } from "../../recipients/recipients.service";
import type { BrevoContact } from "./brevo-client";

/**
 * Which Brevo attribute name feeds each of our fields. Brevo's standard
 * attributes are FIRSTNAME / LASTNAME; DOB and address are custom attributes
 * whose names vary per account, so they're configurable. Only name is
 * required to import a contact.
 */
export interface BrevoFieldMapping {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressPostcode?: string;
  addressCountry?: string;
}

export const DEFAULT_BREVO_MAPPING: BrevoFieldMapping = {
  firstName: "FIRSTNAME",
  lastName: "LASTNAME",
};

/** Reads a Brevo attribute as a trimmed string, or null when absent/blank or
 * not a scalar (arrays/objects aren't a mappable field value). */
function attr(contact: BrevoContact, name: string | undefined): string | null {
  if (!name) {
    return null;
  }
  const value = contact.attributes[name];
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * Maps one Brevo contact to our normalized shape, or null when it lacks the
 * required first/last name (a contact we can't address a card to). The Brevo
 * contact id is the stable externalId the ingest funnel dedupes on.
 */
export function mapBrevoContact(
  contact: BrevoContact,
  mapping: BrevoFieldMapping,
): NormalizedContact | null {
  const firstName = attr(contact, mapping.firstName);
  const lastName = attr(contact, mapping.lastName);
  if (!firstName || !lastName) {
    return null;
  }

  return {
    externalId: String(contact.id),
    firstName,
    lastName,
    email: contact.email?.trim() || null,
    dateOfBirth: parseDate(attr(contact, mapping.dateOfBirth)),
    addressLine1: attr(contact, mapping.addressLine1),
    addressLine2: attr(contact, mapping.addressLine2),
    addressCity: attr(contact, mapping.addressCity),
    addressPostcode: attr(contact, mapping.addressPostcode),
    addressCountry: attr(contact, mapping.addressCountry),
  };
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
