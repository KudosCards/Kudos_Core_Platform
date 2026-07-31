import type { CsvColumnMapping, CsvImportField } from "@kudos/shared-types";

/** Normalise a header for fuzzy matching: lowercase, strip everything but
 * a–z0–9 (so "First Name", "first_name", "First-Name" all collapse to one). */
function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Known header aliases per field, normalised. Ordered longest/most-specific
 * first isn't required (we match on exact equality), but keep the obvious
 * real-world exports covered: HR systems, Mailchimp/Brevo, Outlook, Excel.
 */
const FIELD_ALIASES: Record<CsvImportField, string[]> = {
  firstName: ["firstname", "first", "forename", "givenname", "fname", "christianname"],
  lastName: ["lastname", "last", "surname", "familyname", "lname"],
  dateOfBirth: ["dateofbirth", "dob", "birthday", "birthdate", "bday", "dateofbirthddmmyyyy"],
  addressLine1: [
    "addressline1",
    "address1",
    "addressline",
    "address",
    "addr1",
    "addr",
    "street",
    "streetaddress",
    "line1",
  ],
  addressLine2: ["addressline2", "address2", "addr2", "line2"],
  addressCity: ["city", "town", "citytown", "towncity", "posttown"],
  postcode: ["postcode", "postalcode", "zip", "zipcode", "postcode", "poscode"],
  email: ["email", "emailaddress", "mail", "emailaddress1"],
};

/** Field precedence when two fields could claim the same column (they rarely
 * do, but this keeps the assignment deterministic and prevents double-use). */
const FIELD_ORDER: CsvImportField[] = [
  "firstName",
  "lastName",
  "email",
  "dateOfBirth",
  "postcode",
  "addressLine1",
  "addressLine2",
  "addressCity",
];

/**
 * Best-guess mapping of field → source column for a set of CSV headers, so the
 * common case (sensibly-named columns) imports with no manual mapping. A header
 * is claimed by at most one field; a field with no confident match is left
 * unmapped for the user to fill.
 */
export function suggestMapping(columns: string[]): CsvColumnMapping {
  const normalisedByColumn = new Map(columns.map((c) => [c, normalise(c)]));
  const taken = new Set<string>();
  const mapping: CsvColumnMapping = {};

  for (const field of FIELD_ORDER) {
    const aliases = FIELD_ALIASES[field];
    const match = columns.find(
      (col) => !taken.has(col) && aliases.includes(normalisedByColumn.get(col) ?? ""),
    );
    if (match) {
      mapping[field] = match;
      taken.add(match);
    }
  }
  return mapping;
}

/**
 * Rewrite one parsed CSV row (keyed by the file's own column names) into a row
 * keyed by our canonical field names, per the chosen mapping. Unmapped fields
 * are simply absent — the downstream row parser treats those as blank. This is
 * the only transform the mapping adds; all validation/dedupe/cap logic runs on
 * the result exactly as it does for a natively-named CSV.
 */
export function remapRow(
  row: Record<string, string>,
  mapping: CsvColumnMapping,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, sourceColumn] of Object.entries(mapping)) {
    if (!sourceColumn) continue;
    const value = row[sourceColumn];
    if (value !== undefined) {
      out[field] = value;
    }
  }
  return out;
}
