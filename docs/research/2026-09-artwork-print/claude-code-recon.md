# Second recon — artwork to printed card

An independent read of the artwork path against `f541d6c`, checking the Cowork
recon (`kudos-artwork-print-recon.md`) rather than repeating it. Every claim
below points at a file and a line, and the ones that could be settled by running
something were run rather than reasoned about.

**Headline: the recon is sound.** Its central finding is a real, live defect, its
diagnosis of the print path is correct, and one claim I initially thought was
wrong turned out to be right — I had measured the wrong property. Four things
need correcting or adding before any of it lands.

## Verification

### Verified against the code

|        | Claim                                                              | Evidence                                                                                                                                                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F1** | `designs-client.tsx` uses `CARD_HEIGHT = 600` against a 634 canvas | `apps/web/src/app/(app)/designs/designs-client.tsx:54`. **Confirmed, and worse than stated:** the comment on line 50 says "The card canvas is 450×600 (see design-canvas.tsx)" while `design-canvas.tsx:49` reads `CANVAS_HEIGHT = CARD_HEIGHT` — 634. The comment cites the file that has the right answer as authority for the wrong one.                  |
| **F1** | the upload is placed as a stretched element                        | `artworkDocument` (line 70) emits `width: 450, height: 600`; `render.ts:351` draws `doc.image(data, 0, 0, { width, height })` — both axes given, so pdfkit stretches. Konva does the same. A correctly-exported 1240×1748 upload is squashed ~5.4% vertically (it would need to be 5.7% taller to be right), then sits above a 34-unit ≈ 7.9 mm white strip. |
| **F2** | nothing enforces shape or resolution server-side                   | `design-assets.service.ts:27` writes `dto.width`/`dto.height` straight to the row; `create-design-asset.dto.ts` only checks they are positive integers. The browser's word, unverified.                                                                                                                                                                      |
| **F3** | `sharp.metadata()` ignores EXIF orientation                        | Run, not assumed: a 200×100 JPEG tagged orientation 6 reports `200x100` from `sharp.metadata()`, `100x200` after `.rotate()`. `catalog-sync.service.ts:606` uses the unoriented figure.                                                                                                                                                                      |
| **F5** | the engine emits one A6 face per page                              | `render.ts:7` — "One physical page per face" — and `renderRunPdf` opens a page per `PrintFaceInput`. The A6/borderless incompatibility is a printer-specification fact I cannot test here, but the code claim is exact.                                                                                                                                      |
| **F7** | the reserved footer is always clipped                              | `print-run-pdf.service.ts` passes no footer option; `render.ts` clips at `backReservedFooterTop`.                                                                                                                                                                                                                                                            |
| —      | the catalog crop gate exists and is off                            | `catalog-crop-gate.service.ts`, keyed on `PLATFORM_SETTING_KEYS.catalogRejectCroppedArtwork`, `GET/PUT /catalog/crop-gate`.                                                                                                                                                                                                                                  |
| —      | the two renderers agree; `coverCrop` is correct                    | Matches both shipped plans; no drift found.                                                                                                                                                                                                                                                                                                                  |

### Corrected — in the recon's favour

**F3's pdfkit claim is right, and my first check said otherwise.** I probed
`doc.openImage(bytes).width/height` and got the stored `200x100`, which looked
like a refutation. It was the wrong property: `pdfkit.js:3821` stores
`orientation` separately, and `:4064` swaps width and height at _draw_ time for
orientation > 4, before the `cover` fit is computed (`:4090`). So the **print
output is EXIF-correct today** — including `drawImageBackground`, which delegates
the fit to pdfkit's own `cover`.

That narrows F3's blast radius and makes the recon's own framing exactly right:
this is not a rendering fault, it is a **measurement** fault, and it becomes a
false _refusal_ the day a gate reads `sharp.metadata()` without orienting first.
The gate in commit 1 does orient. The catalog sync still does not.

### New findings

**N1 — The printed footer draws a fake QR. (S, blocking for `backFooter: "print"`)**
`render.ts`, patch line 2686:

```js
if (qrUrl) drawQr(doc, qrSidePt, qrUrl);
else drawQrPlaceholder(doc, qrSidePt);
```

A card with no message page (`messagePageSlug` null — `print-run-pdf.service.ts:105`)
prints a **placeholder square** next to the caption "Scan to see your message",
on a real card, to a real recipient. Today this is harmless because the footer is
clipped and the stock is pre-printed; the moment `backFooter: "print"` is switched
on it is a defect in the post. The caption is unconditional too. Fix: draw
neither when there is no URL, and let the band be plain white.

**N2 — The duplex flip axis is unverified, and it decides whether the inside
prints upside-down. (S, belongs in Phase 2)**
The imposition itself is right — I checked it physically: on a left-hand fold the
outside reads back | front and the inside reads inside-left | inside-right, which
is exactly what `kudos-sample-folded-a5.pdf` produces. But manual duplex depends
on which axis the operator flips the stack about, and a landscape sheet with a
vertical fold is precisely the case where long-edge and short-edge flipping give
different results — one of them rotated 180°. The recon asserts "odd/even page
order is exactly what the driver's manual duplex expects"; that is the one claim
in it resting on the driver rather than on code or specification.
`kudos-borderless-calibration.pdf` measures the overhang beautifully and does not
test this at all. It should: an asymmetric mark on each side of one sheet settles
it in a single print.

**N3 — Colour profiles are dropped, so sRGB normalisation is required, not
optional. (M)**
`decodeImage` passes PNG/JPEG bytes through untouched (`image-loader.ts`), and
pdfkit assigns a colour space from the channel count alone —
`COLOR_SPACE_MAP = {3: 'DeviceRGB', 4: 'DeviceCMYK'}` at `pdfkit.js:3810`, with
**no ICC profile written** into the image object (`:3856`). So an upload saved in
Adobe RGB or ProPhoto has its profile silently discarded and its numbers
reinterpreted as device RGB — visibly desaturated, and most so in the saturated
colours a ten-ink pigment printer exists to reproduce. The recon files this as
Phase 3(c) "if colour is off". It is stronger than that: for any non-sRGB upload
the output is _already_ wrong, and converting in `sharp` is the fix.

**N4 — `ResolvedImage.width`/`height` have no consumer in the renderer. (S)**
`decodeImage` computes them on every asset; `render.ts` never reads them. They
are the unoriented figures, and the patch introduces the first consumer
(`drawPrintedFooter` scaling the logo). Harmless for a controlled logo, but a
field that is both unused and wrong is a trap for the next caller. Either orient
them at source or drop them.

## Test results

Green at `f541d6c`, everything, run here: **988 API unit, 792 API e2e, 259 web**,
plus lint, typecheck, Prettier, ADR index and build. The e2e suite the recon
could not run is the one I could, and it passes — but note that is HEAD, _not_
HEAD with the patch applied.

**The patch does not apply to HEAD.** `git apply --check` on `f541d6c`:

- **Commit 1 (the artwork gate) applies cleanly** — all eleven files.
- **Commit 2 (the print pipeline) fails** on `print-run-pdf.service.ts`,
  `fulfillment-client.tsx` and `fulfillment/page.tsx`.

The recon was cut at `d06c5e2`; we are twelve commits past it (#451–#462), and
#455 rewrote `print-run-pdf.service.ts` (`PRINT_RUN_BLEED_MM`, `facesOf`,
`printedCardMergeContext`) while #457 and #460 rewrote the fulfilment client.
Nothing is lost — the conflicts are in code that moved for good reasons — but
commit 2 needs re-applying by hand rather than by `git am`.

## Route forward

The recon's phase order is right on its own terms; I would change where it
starts. Its Phase 0 lands both commits together, which couples a clean-applying
customer-facing bug fix to a print pipeline that no longer applies and whose
defaults nobody has calibrated yet.

|       |                                                                                          | Why here                                                                                                                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Fix F1 alone                                                                             | The live defect, on the premium path (`customArtworkEnabled` — Pro/Centre). Every day it stands, another customer's own artwork prints squashed under a white strip. Commit 1 applies cleanly; this is the only phase that is pure subtraction of a bug. |
| **2** | The artwork gate, with N4                                                                | The rest of commit 1: one pure definition, refuse pre-upload, enforce at `parseDocument`. Fail-open on infrastructure is the right call and I would not push back on it.                                                                                 |
| **3** | Calibrate — no code                                                                      | Print the calibration sheet **and** an N2 flip test. Thirty minutes, and it is what tells us whether the folded-sheet defaults are right before they ship.                                                                                               |
| **4** | Re-impose the print pipeline                                                             | Commit 2, re-applied onto current `print-run-pdf.service.ts`, with N1 fixed and the calibrated overhang as the default.                                                                                                                                  |
| **5** | Re-export the catalog, close its gate                                                    | Unblocked by none of the above and blocking none of it — it can run in parallel the moment someone has the artwork.                                                                                                                                      |
| **6** | N3 colour, then EXIF in the sync (their Phase 4), distortion at checkout (their Phase 5) | Quality work, once the geometry is settled.                                                                                                                                                                                                              |
| **7** | Retire Browser print                                                                     | Last, deliberately: it is the fallback if anything above goes wrong in the post.                                                                                                                                                                         |

## The four decisions still yours

The recon's §6, unchanged — they are product calls, not engineering ones. My
recommendations, for what they are worth:

1. **Distortion: warn, don't block.** The reserved footer blocks because it has
   no false positives; distortion has one — deliberate stretching with the lock
   off. Warn at checkout (their Phase 5) so it is caught before money changes
   hands, and leave the save alone.
2. **Legacy 450×600 designs: migrate.** The conversion is mechanical and
   reversible, and the alternative is a flag on a screen the customer has no
   reason to revisit. Small, and it retires the defect instead of labelling it.
3. **Footer layout** — needs the measurements off a pre-printed blank. Nobody
   can guess this one.
4. **Master size: 1748 × 2480.** It is 300 dpi at either size; 1240 × 1748 is
   213 dpi on A5, and the whole point of re-exporting 217 files is not to do it
   twice.
