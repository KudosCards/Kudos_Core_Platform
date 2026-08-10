import type { AccountType } from "@prisma/client";

/** The name attributes we send to Brevo for a subscriber, derived from the
 * single `name` we capture at signup plus the account type. */
export interface DerivedContactName {
  firstName?: string;
  lastName?: string;
  company?: string;
}

/**
 * Turn the one `name` field a subscriber gives at signup into Brevo's structured
 * FIRSTNAME / LASTNAME / COMPANY.
 *
 * - **organisation**: `name` is the company name → `company`. We don't collect a
 *   separate contact person, so first/last stay empty.
 * - **individual**: `name` is a person's name. We split on the LAST whitespace so
 *   the surname is the final token and everything before it is the first/given
 *   name(s) — "Mary Jane Watson" → first "Mary Jane", last "Watson". A single
 *   token ("Cher") becomes the first name with no surname.
 *
 * This is a best-effort split of a free-text field; it's deliberately forgiving
 * (trims, collapses inner whitespace) and never throws. If we later capture
 * first/last name explicitly at signup, callers can pass those through instead.
 */
export function deriveContactName(type: AccountType, name: string): DerivedContactName {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) return {};

  if (type === "organisation") {
    return { company: cleaned };
  }

  const lastSpace = cleaned.lastIndexOf(" ");
  if (lastSpace === -1) {
    return { firstName: cleaned };
  }
  return {
    firstName: cleaned.slice(0, lastSpace),
    lastName: cleaned.slice(lastSpace + 1),
  };
}
