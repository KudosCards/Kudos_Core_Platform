# 0138 — A5 / A6 print sizes with a true-size print run

## Status

Accepted — implemented.

## Context

Printing the physical card is the heart of fulfilment, but the ops print run
never produced a true physical size:

- `card-format.ts` hard-coded a single size (**A6**, 105 × 148 mm). A5 did not
  exist anywhere, and the customer copy promised "more sizes coming soon".
- The ops **print run** (`print-run-overlay.tsx` + the `@media print` block in
  `globals.css`) rendered each personalised face as a **fixed 360 px Konva
  canvas floated in the middle of the browser's default page** (A4 / Letter).
  There was no `@page` size, no millimetre dimensions, no one-card-per-page, and
  no safe margin — so "Save as PDF" produced a small image on an A4 sheet, not a
  card an operator could print and trim to size.

We want ops to be able to print at **A5 or A6**, choose which per run, and get a
preview that is exactly what prints.

Two facts make this tractable:

1. **A5 and A6 are the same shape** (both ISO A, 1 : √2). So one design prints at
   either size just by scaling — the only real difference is the physical page.
2. The design canvas is authored at **450 × 600** (3 : 4 ≈ 0.75), a touch taller
   than the A-series (≈ 0.707). Rebasing the canvas to true A proportions would
   shift every existing design, so instead we **fit** the 3 : 4 face inside the
   A-page without distortion, centred, with a small safe margin.

## Decision

### Size model (`shared-types/card-format.ts`)

Replace the single A6 constant with a small multi-size model: `CardSize`
(`"A5" | "A6"`), a `cardSizeSchema` (zod), the millimetre dimensions per size,
label helpers, and two pure print-geometry helpers:

- `mmToCssPx(mm)` — millimetres → CSS pixels at the paged-media 96 dpi reference,
  so a Konva canvas rendered at that pixel width prints at exactly that
  millimetre width.
- `fittedCardMm(size, marginMm)` — the page size and the centred card box (mm)
  for a size, fitting the 3 : 4 face inside the printable area without
  distortion. Width-bound on both A5 and A6, but clamped on height too so it is
  correct for any future size.

The old `CARD_SIZE_*` constants stay as **backward-compatible aliases** bound to
`DEFAULT_CARD_SIZE` (A6), so the customer-facing copy (card library, preview,
checkout) is unchanged — customers still see a single stated size; they do not
pick one.

### Where the size comes from — ops per run, with a super-admin default

- **Super-admin default.** A new `PlatformSetting` key `default_print_card_size`,
  read/written through `CardSizeConfigService` and exposed at
  `GET/PUT /admin/print/card-size` (PlatformAdmin-gated, mirroring the
  dispatch-config pattern). A panel on `/admin` edits it. Falls back to the house
  default (A6) when unset or a stored value is invalid.
- **Per-run override.** The print overlay opens on that default but has an
  **A5 / A6 toggle**; the operator can switch for an individual run. The choice
  is client-side only (it just drives page geometry), so it needs no new order or
  job field.

### True-size print run (`print-run-overlay.tsx`)

- An injected `@page { size: <w>mm <h>mm; margin: 0 }` that tracks the chosen
  size, so each face is its own physical A5/A6 page.
- Each face is laid out inside a millimetre-sized page box with the card fitted
  and centred (`fittedCardMm`). **The same mm page box is the on-screen preview
  and the printed page**, so preview = print.
- The face is rendered at `mmToCssPx(cardWidthMm)`, so the canvas is physically
  the right size on paper.
- `CardFacePreview` gained a `bordered` prop; the print run turns the frame off
  so nothing but the artwork reaches the page.

## Consequences / blast radius

- Confined to the shared card-format module, the ops print overlay + its
  admin-configured default, and the fulfilment page that reads it. **No** change
  to payment, wallet, fulfilment state, the order/job schema, or the public
  `/r/<slug>` page. No migration (the default rides the existing key/value
  `PlatformSetting` table).
- Because A5 and A6 share a proportion, a design needs no per-size variants — the
  same document prints at both.
- The customer-facing size copy is unchanged (still the default size); if we ever
  let customers _choose_ a size, that is a separate change.

## Alternatives considered

- **Rebase the design canvas to true A proportions (1 : √2).** Edge-to-edge art,
  but it shifts every existing design's layout — rejected in favour of fitting
  the existing 3 : 4 face with a small margin (no distortion, no rework).
- **Store the size per design or per order.** Heavier (schema + migration +
  choosing at design/checkout time) and not what was asked: the size is an
  operational print decision, so an ops-per-run choice with a super-admin default
  fits best. A per-design size can be layered on later without undoing this.
- **A single global size with no per-run override.** Simplest, but an operator
  printing a one-off at the other size would have to change the platform default
  — the per-run toggle avoids that.
