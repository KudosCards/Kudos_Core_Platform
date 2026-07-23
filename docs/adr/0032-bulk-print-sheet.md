# ADR 0032 — Bulk print sheet: one PDF of a whole run's personalised cards

Status: accepted
Date: 2026-07-23

## Context

After ADR 0031 made `{name}` personalisation real, ops could **preview** one personalised card at a
time in the fulfilment queue, but producing a print run still meant opening each card individually.
The ask: "one download of all personalised cards for a run."

## Decision

### API — `POST /fulfillment/print-run`

Ops-only (PlatformAdminGuard), mirrors the existing audited address export exactly: takes `jobIds`,
returns each job's `{ recipientFirstName, recipientLastName, savedDesignName, document }`, and writes
one `fulfillment_print_run` audit row per card in the same transaction as the read — because this
reveals a child's name against a specific card, the same recipient-PII access the audit trail exists
for. Reuses `ExportAddressesDto` (same `jobIds` shape, same 500 ceiling = one run).

### Web — native print, no PDF library

Selecting jobs in the fulfilment queue and choosing **"Print sheet"** fetches the run and opens a
full-screen `PrintRunOverlay` that renders each card's front **with the name merged in**
(`applyMergeTokens` + the `CardFacePreview` renderer from ADR 0031), one card per page. A toolbar
offers **"Print / Save as PDF"**, which calls `window.print()`; the operator uses the browser's
built-in "Save as PDF".

No PDF/jsPDF dependency: a small `@media print` block in `globals.css` hides the app and the toolbar
when the overlay is open (`body[data-printing] > *:not([data-print-run])`), and `break-after-page`
puts one card per page. This is the lowest-dependency path that produces a real, shareable PDF, and
it reuses the exact renderer customers already see — so the printed sheet matches the preview.

## Alternatives considered

- **Server-side vector PDF (headless render / PDFKit)** — highest fidelity and fully automatable, but
  a substantial new pipeline for a workflow that's still manual ops. The `printRun` endpoint already
  returns everything such a pipeline would need, so this stays a clean future upgrade.
- **A client PDF library (jsPDF + canvas)** — assembles a file without the print dialog, but adds a
  dependency and rasterises via `toDataURL` at whatever DPI we pick; the browser's own print path
  gives better default quality and zero deps.

## Consequences

- An operator produces a whole run's personalised cards as one PDF in two clicks, each already
  carrying the right recipient's name.
- Every card pulled into a print run is audited, exactly like the address export — no new PII path
  that dodges the trail.
- The card faces are raster (Konva canvas) at screen scale; fine for the current manual workflow.
  Print-grade DPI is the reason a server-side vector render is the natural next step if volumes grow.
