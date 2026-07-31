import { z } from "zod";

/**
 * The canonical recipient fields a CSV import can fill, in display order. A
 * customer's spreadsheet almost never uses these exact header names ("First
 * Name", "Surname", "DOB", "Post Code"…), so the importer lets them map their
 * columns onto these fields rather than forcing them to rename headers first.
 * `key` doubles as the row key the API's row parser reads (see csv-row.util),
 * so the mapped-in value flows straight through the existing import pipeline.
 */
export const CSV_IMPORT_FIELDS = [
  { key: "firstName", label: "First name", required: true },
  { key: "lastName", label: "Last name", required: true },
  { key: "dateOfBirth", label: "Date of birth", required: false },
  { key: "addressLine1", label: "Address line 1", required: false },
  { key: "addressLine2", label: "Address line 2", required: false },
  { key: "addressCity", label: "Town / city", required: false },
  { key: "postcode", label: "Postcode", required: false },
  { key: "email", label: "Email", required: false },
] as const;

export type CsvImportField = (typeof CSV_IMPORT_FIELDS)[number]["key"];

/**
 * A column mapping: which uploaded CSV column feeds each of our fields. Every
 * field is optional — an unmapped field is simply left blank on import (the
 * pipeline is import-and-flag, so a contact missing an address still imports).
 * The two required fields (first/last name) are enforced at the UI + row level.
 */
export const csvColumnMappingSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  dateOfBirth: z.string().min(1).optional(),
  addressLine1: z.string().min(1).optional(),
  addressLine2: z.string().min(1).optional(),
  addressCity: z.string().min(1).optional(),
  postcode: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
});
export type CsvColumnMapping = z.infer<typeof csvColumnMappingSchema>;

/**
 * What `POST /recipients/import/preview` returns: the detected columns, a few
 * sample rows to show the customer, the data-row count, and a best-guess
 * mapping so the common case (sensibly-named columns) needs zero clicks.
 */
export const csvImportPreviewSchema = z.object({
  /** Header names, in file order. */
  columns: z.array(z.string()),
  /** The first few data rows (keyed by column name) for a preview table. */
  sampleRows: z.array(z.record(z.string(), z.string())),
  /** Total data rows in the file (excludes the header). */
  totalRows: z.number().int().nonnegative(),
  /** Auto-detected field → column guesses; the UI pre-fills the dropdowns with these. */
  suggestedMapping: csvColumnMappingSchema,
});
export type CsvImportPreview = z.infer<typeof csvImportPreviewSchema>;
