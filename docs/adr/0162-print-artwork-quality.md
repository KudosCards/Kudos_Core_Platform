# 0162 — Print artwork quality: high-DPI raster now, server-side vector PDF next

## Status

Accepted — Phase 0 implemented; Phase 1 (server-side vector PDF) planned.

## Context

Operators reported that the artwork on the fulfilment print/PDF is not sharp
enough for a quality printed product. Tracing the print path:

- Super-admin fulfilment opens `PrintRunOverlay`, which renders each card **face
  as a Konva `<canvas>`** at `cardWidthPx = mmToCssPx(cardWidthMm)` — i.e. sized
  in CSS px against the 96dpi paged-media reference.
- The operator clicks "Print / Save as PDF", which calls `window.print()`; the
  browser rasterises the canvas into the PDF.

Three quality ceilings sit in that chain:

1. **The canvas is ~96–192 dpi.** Konva's backing store defaults to the device's
   `devicePixelRatio` (1 on most ops monitors, 2 on Retina). Across a ~95 mm A6
   face that is ~96–192 dpi versus the 300 dpi print standard — so the printer
   upscales the bitmap. This is the dominant cause of the softness.
2. **Text is rasterised, not vector.** Konva bakes text into the bitmap, so it
   gets the same low-dpi softness instead of crisp vector glyphs.
3. **Source artwork resolution isn't guaranteed** and becomes the ceiling once
   dpi is fixed (catalog `copyImage` stores the Airtable attachment as-is; user
   uploads aren't resolution-gated).

Plus there is no bleed, no crop marks, and output depends on each operator's
browser/print dialog rather than being deterministic.

## Decision

### Phase 0 — high-DPI raster (this change)

Render the Konva print faces at a print-grade backing-store density instead of
the device default. `CardFacePreview` gains an optional `pixelRatio` prop; when
set it calls `layer.getCanvas().setPixelRatio(...)` on each layer and redraws, so
the same CSS-sized face is backed by far more pixels. `PrintRunOverlay` passes
`300 / 96` (~3.125×), lifting the rasterised face from ~96–192 dpi to ~300 dpi.

This is a drop-in win on the existing architecture — it reuses the exact WYSIWYG
Konva rendering, so there is zero fidelity risk. It does not make text vector or
raise source-image resolution; those come next.

### Phase 1 — server-side vector PDF (planned, chosen target)

Move PDF generation off the operator's browser to a **deterministic server-side
renderer in the API**, downloadable from super-admin, producing a **true vector
PDF**: the design document is rendered to HTML/SVG and converted to PDF via the
bundled headless Chromium (`page.pdf()`). This gives:

- **Vector text** (embedded fonts) — razor sharp at any zoom.
- **Images embedded at full native resolution**, placed at ≥300 dpi.
- **3 mm bleed + crop marks + trim geometry** for a clean cut.
- Deterministic output independent of the operator's browser/printer dialog.

Fidelity against the editor (fonts, text wrapping, element positions) is the main
risk of the HTML/SVG render, so it will be validated with golden-image checks
against the existing Konva preview before becoming the production path. **CMYK /
PDF-X is explicitly out of scope** — a high-resolution RGB PDF with bleed and
crop marks is sufficient for the print house.

### Phase 2 — guardrails (planned)

Enforce ≥300 dpi with a pre-flight warning when a source image is too low-res,
store catalog originals at full resolution, and gate user uploads on a minimum
resolution.

## Consequences

- The print/PDF is immediately much sharper (~300 dpi) with no change to how the
  card renders, so preview still equals print.
- **Large-run memory:** `PrintRunOverlay` mounts every face at once, so a denser
  backing store raises browser memory use on very large runs. 300 dpi (not 600)
  is chosen as the safe browser default; the Phase 1 server-side renderer removes
  this ceiling by rendering per-face off the browser.
- Text sharpness and source-image resolution are unchanged until Phase 1 / 2.
