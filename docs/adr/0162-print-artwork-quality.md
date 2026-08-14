# 0162 — Print artwork quality: high-DPI raster now, server-side vector PDF next

## Status

Accepted — Phase 0 implemented; Phase 1 implemented (pure-Node vector PDF engine
+ image pipeline); Phase 2 implemented (ops download endpoint + super-admin
"Download print-ready PDF" button + source-image resolution pre-flight warning,
plus a design-time editor low-resolution warning); Phase 3 implemented
(emoji/symbol glyph fallback in the PDF text engine).

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

**Image pipeline (Phase 1b, implemented).** Image elements and cover-crop image
backgrounds are resolved through an injected async `ImageResolver`
(`image-loader.ts`): it fetches the asset (an uploaded `https://…` or a
root-relative bundled sticker resolved against the web base URL), passes PNG/JPEG
through untouched, transcodes WebP/GIF/other rasters to PNG, and **rasterises SVG
stickers to a crisp 1024px PNG via sharp** (robust across arbitrary SVGs, one
raster draw path). It is resilient — a missing, oversized, timed-out or
undecodable asset is skipped rather than failing the run — and caches per URL so a
background reused across a run's recipients is fetched once. Image elements
stretch to their box and rotate about the top-left (as Konva); backgrounds
centre-crop to cover the full bleed page.

**Known limitations (tracked):** a glyph the embedded font lacks (emoji, unusual
symbols in text) renders as a missing-glyph box rather than falling back to a
system font as the browser would — acceptable for Latin names/messages, a
candidate for a later symbol-fallback pass. *(Resolved in Phase 3.)*

### Phase 2 — download path (implemented) + source guardrails (planned)

**Download path (implemented).** An ops-only `POST /fulfillment/print-run/pdf`
(`PrintRunPdfService`) renders a selected run to one multi-page PDF via the
engine and streams it as a download. It reuses `FulfillmentService.printRun` for
the *audited* read (one `fulfillment_print_run` record per card, exactly like the
JSON path), merges each recipient's tokens into their design, builds the QR link
from `WEB_APP_URL`, and constructs the `ImageResolver` with that base URL so
bundled stickers resolve. The super-admin fulfilment print overlay now offers
**"Download print-ready PDF"** as the primary action (with the existing A5/A6
picker), keeping browser-print as a labelled secondary fallback.

**Trim-exact output for print-and-fold (revised).** Kudos prints these cards and
folds them in-house rather than trimming to a cutter line, so bleed and crop
marks are noise — the corner registration marks landed on the finished cards and
the 3 mm bleed made the page larger than the card. The ops download now renders
at the **exact trim size with no bleed and no crop marks** (`renderRunPdf({
cropMarks: false, bleedMm: 0 })`; `faceGeometry` takes an optional `bleedMm`).
The engine keeps bleed + crop marks available (defaults unchanged) for a future
print house that trims; only the ops call opts out.

**Source resolution pre-flight (implemented).** A shared pure helper
(`shared-types/print-quality.ts`) defines "effective print DPI" — source pixels
along an axis ÷ that axis's printed length — with a 300 dpi target and a
`< 200 dpi` warn threshold, plus `collectPrintImageTargets` (every raster image a
design prints + the physical size it prints at, SVG excluded). The ops print
overlay uses it as a **pre-flight**: it loads each unique run image's natural
pixel size and warns "N image(s) are low-resolution for this size and may look
soft" before the operator prints/downloads. Non-blocking (a warning, not a gate),
and it re-checks when the A5/A6 choice changes.

**Design-time editor warning (implemented).** The card editor's image-properties
panel reuses the same `shared-types/print-quality` helpers to show the selected
image's effective print DPI live, warning the customer while they place/resize an
image — the point where a soft image can actually be fixed. Green tick at ≥ 300
dpi, amber note in 200–300, red warning below. Non-blocking, recomputes as the
element is resized, SVGs skipped.

**Source resolution, resolved and deferred.** Catalog originals are *already*
stored at full resolution: the Airtable source copies each attachment's original
`url` (not a thumbnail) byte-for-byte into our storage, so the "catalog stores
the attachment as-is" note above is benign. A **hard minimum on customer uploads**
was considered and deliberately *not* built — uploads already surface the low-DPI
warning at both design time and ops pre-flight, and a hard gate would reject
legitimate small logos/stickers for little gain.

### Phase 3 — emoji/symbol glyph fallback (implemented)

The text engine embeds one font per element, so a glyph that font lacks (an
emoji, a dingbat) printed as a `.notdef` "tofu" box — the one place print did
*not* match the editor, which falls back to a system font. Phase 3 reproduces
that fallback deterministically:

- **Vendored fallback faces** (`scripts/vendor_print_fonts.py`, Phase 3): Noto
  Sans (broad Latin/Greek/Cyrillic + punctuation), Noto Sans Symbols (arrows,
  maths, music), Noto Sans Symbols 2 (stars, card suits, dingbats, ticks), Noto
  Emoji (emoji). Regular weight only.
- **Coverage-aware runs** (`glyph-runs.ts` + `coverage.ts`): each line is split
  into runs, every character routed to the first font — the element's own font,
  then the fallbacks in order — that has a glyph for it (fontkit's
  `hasGlyphForCodePoint`; WinAnsi for the built-in standard fonts). ZWJ and
  variation selectors stay with their base so emoji sequences hold together; a
  glyph no font has still prints in the primary (best-effort, as before). Runs
  are drawn each in their own font, and wrap/alignment measure the *mixed* width
  so lines break and centre exactly where the editor puts them. Pure-Latin text
  is a single primary-font run — byte-identical to Phase 1.
- **Monochrome emoji:** a pdfkit PDF can't carry colour-emoji (COLR/CBDT) tables,
  so emoji print as monochrome glyphs. CJK/Arabic remain out of scope (each needs
  its own large font); this covers what customer names and messages contain.

## Consequences

- The print/PDF is immediately much sharper (~300 dpi) with no change to how the
  card renders, so preview still equals print.
- **Large-run memory:** `PrintRunOverlay` mounts every face at once, so a denser
  backing store raises browser memory use on very large runs. 300 dpi (not 600)
  is chosen as the safe browser default; the Phase 1 server-side renderer removes
  this ceiling by rendering per-face off the browser.
- Text sharpness and source-image resolution are unchanged until Phase 1 / 2.
