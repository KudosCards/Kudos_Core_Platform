import type { NormalizedContact } from "../../recipients/recipients.service";
import type { HubSpotContact } from "./hubspot-client";

/**
 * Which HubSpot property name feeds each of our fields. HubSpot's standard
 * contact properties are firstname / lastname / email; date_of_birth and the
 * address properties are standard too but named differently per portal in some
 * cases, so they're configurable. Only name is required to import a contact.
 */
export interface HubSpotFieldMapping {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth?: string;
  addressLine1?: string;
  addressCity?: string;
  addressPostcode?: string;
  addressCountry?: string;
}

export const DEFAULT_HUBSPOT_MAPPING: HubSpotFieldMapping = {
  firstName: "firstname",
  lastName: "lastname",
  email: "email",
  dateOfBirth: "date_of_birth",
  addressLine1: "address",
  addressCity: "city",
  addressPostcode: "zip",
  addressCountry: "country",
};

/** The property names to request from HubSpot for a given mapping (HubSpot only
 * returns properties you ask for beyond a tiny default set). */
export function hubspotProperties(mapping: HubSpotFieldMapping): string[] {
  return Array.from(
    new Set(Object.values(mapping).filter((name): name is string => Boolean(name))),
  );
}

/** Reads a HubSpot property as a trimmed string, or null when absent/blank or
 * not a scalar. */
function prop(contact: HubSpotContact, name: string | undefined): string | null {
  if (!name) {
    return null;
  }
  const value = contact.properties[name];
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * Maps one HubSpot contact to our normalized shape, or null when it lacks the
 * required first/last name (a contact we can't address a card to). The HubSpot
 * contact id is the stable externalId the ingest funnel dedupes on.
 */
export function mapHubSpotContact(
  contact: HubSpotContact,
  mapping: HubSpotFieldMapping,
): NormalizedContact | null {
  const firstName = prop(contact, mapping.firstName);
  const lastName = prop(contact, mapping.lastName);
  if (!firstName || !lastName) {
    return null;
  }

  return {
    externalId: String(contact.id),
    firstName,
    lastName,
    email: prop(contact, mapping.email),
    dateOfBirth: parseDate(prop(contact, mapping.dateOfBirth)),
    addressLine1: prop(contact, mapping.addressLine1),
    addressLine2: null,
    addressCity: prop(contact, mapping.addressCity),
    addressPostcode: prop(contact, mapping.addressPostcode),
    addressCountry: prop(contact, mapping.addressCountry),
  };
}

/** HubSpot returns date_of_birth as `YYYY-MM-DD` (or an epoch-ms string for
 * some date properties). Parse leniently; a bad/blank value becomes null. */
function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  // Epoch-milliseconds date properties come back as an all-digit string.
  const asNumber = /^\d+$/.test(value) ? Number(value) : NaN;
  const date = Number.isNaN(asNumber) ? new Date(value) : new Date(asNumber);
  return Number.isNaN(date.getTime()) ? null : date;
}
