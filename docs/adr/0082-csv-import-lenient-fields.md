# 0082 — CSV import: don't reject a whole contact for a malformed optional field

## Status

Accepted

## Context

A customer imported 20 contacts from a CSV and **every row was skipped** — the
import silently failed. The row parser (`csv-row.util.ts`) hard-**rejected the
entire contact** whenever an *optional* field was present but mis-formatted:

- **Date of birth** required strict `dd/mm/yyyy`. Any other format — ISO
  `1990-05-01`, `1/5/1990`, `1 May 1990` — threw and killed the row.
- **Postcode**: any non-UK-format value killed the row.
- **Email**: any malformed value killed the row.

Because a CSV column shares one format across all rows, a single wrong-format
column (most commonly the birthday, exported as ISO by most tools) rejected the
whole file at once. This contradicted the module's own stated design —
"import-and-flag, a bulk source is never silently dropped" — which had only ever
been applied to the *address* fields, not DOB/postcode/email.

Compounding it, the web importer's summary showed only a **count** ("skipped
20") and never the per-row reasons the API already returned, so the failure was
invisible.

(For the record: this was **not** the plan's recipient cap. Free allows 50 and
the entitlement path returns 404 on a genuine misconfiguration rather than
silently skipping — ruled out in code review.)

## Decision

Apply the import-and-flag rule consistently: only first/last name are truly
required; a present-but-malformed *optional* field is dropped with a warning and
the contact still imports.

1. **`parseRecipientRow` returns `{ parsed, warnings }`** instead of throwing on
   an optional-field error. DOB/postcode/email that can't be used are set to
   `null` and a human-readable warning is recorded. Missing first/last name is
   still a hard rejection.
2. **`parseFlexibleDate`** broadens accepted birthday formats to `dd/mm/yyyy`
   (primary), `dd-mm-yyyy`, and unambiguous ISO `yyyy-mm-dd` — the formats real
   exports use. Ambiguous US `mm/dd/yyyy` is deliberately not guessed. Anything
   still unrecognised imports without a DOB + a warning. `parseUkDate` stays
   strict (dd/mm/yyyy) — it documents the canonical contract and isn't on the
   lenient CSV path.
3. **`ImportSummary` gains `warnings: { row, message }[]`** alongside `rejected`,
   threaded through the service and audit metadata.
4. **The web importer surfaces the detail** — expandable lists of the rejected
   reasons *and* the warnings, not just counts — so nothing is silent.

## Consequences

- A normal contacts export (birthdays in ISO or any supported format, the odd
  dodgy postcode/email) now imports cleanly, with clear per-field warnings for
  anything that couldn't be used.
- The only whole-row rejection left is a genuinely unusable row (no name).
- Behaviour change: DOB/postcode/email format errors are warnings, not
  rejections — the two affected e2e tests were updated to the new contract.
  The strict JSON create/update API is unchanged (a manual add still validates
  fully); this is only the bulk import-and-flag path.
- Tests: `csv-row.util.spec` (flexible date + per-field lenient behaviour) and a
  recipients e2e that imports non-`dd/mm/yyyy` birthdays → all rows created with
  warnings, none rejected — a direct reproduction of the reported bug.
