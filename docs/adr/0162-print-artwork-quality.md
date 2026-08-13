# 0162 — Print artwork quality: high-DPI raster now, server-side vector PDF next

## Status

Accepted — Phase 0 implemented; Phase 1 engine core implemented (pure-Node
vector PDF, `apps/api/src/print-pdf`); Phase 1b (image pipeline), Phase 2
(endpoint + super-admin UI, source-image guardrails) planned.

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

### Phase 1 — server-side vector PDF, **pure Node** (chosen; core implemented)

Move PDF generation off the operator's browser to a **deterministic server-side
engine in the API** (`apps/api/src/print-pdf`), producing a **true vector PDF**.

**Engine choice — pure Node (pdfkit), not headless Chromium.** The earlier plan
named headless Chromium + `page.pdf()`. On inspection the API ships **no browser
and no Dockerfile** (it is a plain Node service), so a Chromium route would add an
unverified, heavy runtime dependency to production. Instead the engine draws the
design **directly with pdfkit** — no browser, no HTML/SVG intermediate — so it
deploys anywhere Node runs and its output is fully deterministic. It reproduces
the canonical read-only renderer `card-face-preview.tsx` primitive-for-primitive
(white base → page background → elements in array order), so **print equals the
editor** without a golden-image round-trip against a browser.

Fidelity is achieved by matching the exact contracts the web renderer uses,
read from source (not guessed):

- **Vector text in the exact font.** The 9 self-hosted editor fonts are embedded
  as vendored TTFs (`scripts/vendor_print_fonts.py`); real static Regular/Bold/
  Italic/BoldItalic weights are instantiated from the upstream *variable* Google
  fonts with fontTools' instancer — never faux weights. `Georgia` maps to Gelasio
  (a metric-compatible embedded substitute); the three system stacks (Helvetica,
  Times New Roman, Courier New) map to PDF's built-in standard families. Faces
  with no real bold/italic upstream (Pacifico, Lobster, Dancing Script, Caveat)
  synthesise it (faux-bold / oblique skew) — the same fallback the browser makes.
- **Konva-faithful text layout.** Word-wrap, per-line alignment, `lineHeight` 1.3
  and the modern alphabetic-baseline metric (`(ascent−descent)/2 + lineHeightPx/2`)
  are reproduced using the embedded font's own metrics, so lines break and sit
  where the editor puts them. Rotation is about the element's top-left, as in Konva.
- **Vector shapes and QR.** All six shape primitives match `card-shape.tsx`; the
  QR is drawn as vector modules from the same `qrcode` matrix/options as the web
  (crisper than the web's 512px PNG, same scannable code).
- **Trim geometry, 3 mm bleed, crop marks.** The 450×634 design space maps onto
  the trim uniformly by width (centred vertically, matching `fittedCardMm`); the
  page background bleeds to the page edge and registration marks sit in the bleed.
- **A5 / A6**, one physical page per face, deterministic regardless of operator.

**CMYK / PDF-X is explicitly out of scope** — a high-resolution RGB PDF with
bleed and crop marks is sufficient for the print house.

**Known limitations (tracked):** a glyph the embedded font lacks (emoji, unusual
symbols in text) renders as a missing-glyph box rather than falling back to a
system font as the browser would — acceptable for Latin names/messages, a
candidate for a later symbol-fallback pass. **Image elements and cover-crop image
backgrounds are deferred to Phase 1b** (the core here is network-free; images are
resolved through an injected async `ImageResolver` seam), after which Phase 2
wires the ops download endpoint + super-admin UI and the source-resolution
pre-flight.

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
