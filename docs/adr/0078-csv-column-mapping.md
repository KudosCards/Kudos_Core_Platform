# 0078 — CSV import column mapping

## Status

Accepted

## Context

The contacts CSV import (`POST /recipients/import`) parsed with `csv-parse`
`{ columns: true }` and read fixed keys (`firstName`, `lastName`, `dateOfBirth`,
`addressLine1/2`, `addressCity`, `postcode`, `email`). So the uploaded file's
**header names had to match ours exactly**. A real-world export — from a
spreadsheet, an HR system, Mailchimp/Brevo, Outlook — almost never does
("First Name", "Surname", "DOB", "Post Code"…), so the customer had to rename
every column by hand before importing, or the whole file failed on the required
first/last-name check. That is real friction on the single fastest path to
getting contacts (and therefore orders) into the platform.

This is used in two places: the `/recipients` page and the `/get-started`
onboarding wizard.

## Decision

Add column mapping: upload any CSV, we detect its columns and suggest a mapping,
the customer confirms/adjusts, then imports. No renaming required.

**API**

- `POST /recipients/import/preview` (new) parses the file and returns its
  `columns` (in order), a few `sampleRows`, `totalRows`, and a `suggestedMapping`
  — an auto-detected field→column guess. Reads raw arrays (`columns: false`) so
  the header is available even for a header-only file and column order is
  preserved. No writes.
- `POST /recipients/import` gains an optional `mapping` multipart field (a JSON
  string, validated with `csvColumnMappingSchema`). When present, each parsed row
  is re-keyed from the file's own column names to our canonical field keys
  (`remapRow`) _before_ the existing row parser runs. **Backward compatible**:
  with no mapping, the file must use our canonical headers exactly as before, so
  the API contract and every existing caller keep working.
- Auto-detection (`suggestMapping`) normalises headers (lowercase, strip
  non-alphanumerics) and matches against per-field alias lists, assigning each
  column to at most one field. The common case (sensibly-named columns) needs
  zero manual mapping.
- All validation, dedupe, plan-cap, and audit logic is untouched — mapping only
  adds a key-rename step in front of the existing pipeline.

**Shared types** — `csv-import.ts`: `CSV_IMPORT_FIELDS` (the canonical fields +
labels + required flags), `csvColumnMappingSchema` (all-optional field→column),
and `csvImportPreviewSchema`. One contract for both sides.

**Web** — one reusable `CsvImport` component drives the whole flow: pick a file →
call preview → show mapping dropdowns pre-filled from the suggestion (required
fields flagged) + a small sample-rows table so the customer can see the data
lines up → import. Both `/recipients` and `/get-started` now render it instead of
their own bare file forms, so the experience (and any future improvement) is
shared. Import-and-flag is preserved: a contact missing an address still imports
and is surfaced as "needs address".

Preview parsing is server-side (reusing the same `csv-parse`) rather than adding
a browser CSV-parser dependency: it's robust against quoted fields, keeps the
client light, and the ≤5 MB upload cost is negligible.

## Consequences

- A customer can import a CSV straight out of any tool without editing headers —
  the mapping step does it, with sensible columns pre-matched.
- The legacy "headers must match ours" path still works untouched (no mapping =
  old behaviour), so nothing that already worked breaks.
- Tests: unit (`suggestMapping` alias detection + no double-assignment;
  `remapRow`); e2e (preview reports columns/rows/suggested mapping; an import
  with non-matching headers + a mapping creates a mailable contact). Full
  recipients e2e green (29).
- The same preview + mapping primitives could later back a paste-a-spreadsheet or
  a saved-mapping-per-account flow, but neither is in scope here.
