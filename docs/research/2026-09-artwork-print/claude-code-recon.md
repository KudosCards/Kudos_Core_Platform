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

---

# Addendum — ten-lens sweep

The findings above came from reading the path end to end. This addendum comes from
a second pass built to catch what a linear read misses: ten independent lenses over
the same territory, each finding then refuted twice — once on "does the code
actually say this", once on "does it actually matter" — and a completeness critic
over the result. 39 candidates, **7 survived, 32 were killed.**

The refuters earned their place. They killed candidates on documented-decision
grounds (ADR 0162's QR quiet zone and its skip-don't-fail policy; the deliberate
mixed-typeface fallback), on unreachability (several "a malformed snapshot drops a
card" findings have no write path that can produce one), and on mis-framing. Two
were _this repo's own recorded trade-offs being rediscovered as bugs_ — which is
what a well-documented codebase is supposed to do to an auditor.

I verified all seven survivors myself rather than taking them on trust. Every
number below I reproduced.

## A1 — A corrupt PNG kills the API process (high, S)

`apps/api/src/print-pdf/image-loader.ts:205`. The PNG/JPEG fast path returns the
customer's original bytes untouched after a header-only `sharp().metadata()`.
pdfkit then runs its own JS PNG decoder, and png-js inflates the IDAT with
`zlib.inflate(data, (err) => { if (err) throw err })` — **a throw inside an async
callback**.

Reproduced end to end: `sharp.metadata()` succeeds on a PNG with a valid IHDR and
a corrupted IDAT; `doc.image()` **returns without throwing**; no `error` event
fires on the document; the process then exits on an uncaught
`Error: invalid bit length repeat`. `image-loader.ts`'s careful try/catch and the
resolver's `.catch` are both outside that path and cannot see it. There is no
`uncaughtException` handler anywhere in `apps/api/src` — grepped, zero hits.

So one corrupt asset on one card takes down the whole API process mid-print-run,
killing every other in-flight request. It needs no malice: a truncated upload does
it. Plan step 7 (retiring Browser print) makes this engine the only way to print.

## A2 — No pixel budget anywhere on the path (high, S)

Every limit is a _byte_ limit — the bucket's 10 MB and the loader's
`DEFAULT_MAX_BYTES = 25 MB`. Nothing bounds pixels, and no `limitInputPixels` is
set on any `sharp()` call in the API. A 74-byte PNG declaring 16000×16000 RGBA
passes both limits and drives pdfkit's synchronous PNG path into roughly 2 GiB of
`Buffer.alloc` plus a `deflateSync` on 0.75 GiB, blocking the event loop.
JPEG is unaffected — pdfkit embeds the stream without decoding. This is PNG-specific.

Fixing A2 largely removes A1: nothing reaches pdfkit's decoder undecoded.

## A3 — The run PDF re-embeds the artwork once per page (high, S)

`render.ts:351` and `:366` pass a `Buffer` to `doc.image()`. pdfkit only
de-duplicates when `src` is a **string** (`_imageRegistry`, `pdfkit.js:4045-4052`),
so every page writes a fresh copy of the bytes. The resolver's cache hides it by
de-duplicating the _fetch_, not the _embed_.

Measured: 50 pages drawing one PNG → **1.75 MB naive vs 0.06 MB memoised, a 30.9×
blow-up**, on a flat-colour image that compresses well; a photograph is far worse.
The run ceiling is 500 recipients (`@ArrayMaxSize(500)`), and the whole PDF is held
in memory twice (`chunks` + `Buffer.concat`).

**This blocks plan step 5.** Re-exporting the catalog at 1748 × 2480 multiplies
per-asset bytes, turning a slow run into an OOM. Step 4 compounds it — folded
sheets draw the same background onto more surfaces per sheet. Fix is to memoise
`doc.openImage()` per asset URL and pass the returned object.

_Honest note:_ a weaker framing of this same defect ("40 recipients → 55 MB") was
**refuted** on materiality — "every page carries a correct, full-resolution copy,
so no customer sees anything wrong". That refutation is right about the printed
card and wrong about the plan. The finding survived only because another lens
framed it against step 5's re-export. Worth knowing that the panel's floor is
"does a customer see it", which is not the same bar as "does this block us".

## A4 — WebP uploads print rotated (high, S)

`image-loader.ts:208`. The PNG/JPEG branch passes bytes through and pdfkit honours
their EXIF — which is exactly why the main report concluded the print path was
EXIF-safe. **That conclusion holds only for the passthrough branch.** Every other
format goes through `sharp(buffer).png()`, which neither auto-rotates nor carries
EXIF into the PNG it writes, and pdfkit reads orientation only from JPEG.

Reproduced: the same picture (really 100×200 portrait) keeps `orientation 6` down
the JPEG path and arrives at pdfkit with **no orientation at all** down the WebP
path — drawn flat on its side, then cover-cropped on the wrong axis. WebP is
accepted by both upload inputs in the editor. `sharp(buffer).rotate().png()` fixes
it; verified to give 100×200.

This refines N3/F3 rather than repeating them, and it is a **precondition for the
gate in step 2** — which would otherwise measure an upright image and pass artwork
that prints rotated.

## A5 — The reserved-footer block is rotation-blind (high, S)

`packages/shared-types/src/card-format.ts:255`. `backArtworkInReservedFooter` reads
`y`, `height`, `size`, `fontSize` — and never `rotation`. `reservedFooterViolation`
wraps it, and `assertPrintable` turns it into a hard **400 on every save**.

The editor's own check is rotation-_aware_: `design-canvas.tsx:511` measures
`node.getClientRect({ relativeTo: layer })`. And the sibling module gets it right
deliberately — `card-content.ts:74` is `if (element.rotation) return null;`. So the
advisory check is correct and the **blocking** one is not.

It fails both ways: art rotated 270° paints _upward_ from `y` and is refused
although it is visibly above the line (the design cannot be saved or sent at all),
while text rotated 90° paints downward into the band and saves cleanly, to be
silently clipped at print. This matters more after step 4, which turns that band
from pre-printed stock into something we print.

## A6 — A returned card's free reprint loses the sender's message page (high, S)

`apps/api/src/returns/returns.service.ts:598`. The reprint's
`tx.orderRecipient.create` deliberately copies `occasionId`, `savedDesignId`,
`documentSnapshot` and `postageClass` — and omits `messagePageId`. It is not even
in `CASE_INCLUDE.orderRecipient.select`, so the value is absent from the whole code
path. Every other order-creation path sets it (checkout `:1214`, quickSend `:378`,
bulkSend `:581`, auto-send `:198-227`).

Settlement then reads `recipient.messagePageId ?? null`, falls into the auto-page
branch, and mints a fresh page titled "Your message". The reprinted card prints a
perfectly scannable QR onto a near-empty page — for the one recipient most likely
to scan it, because this is the card that finally arrived.

The code comment three lines above says "the card that comes back is the card that
was sent". It is true of the artwork and not of the QR. Two lines to fix.

## A7 — SVGs are flattened to 1024px, and the pre-flight exempts them for a reason that is no longer true (medium, M)

`print-quality.ts:104` excludes SVG from every resolution pre-flight because "an
asset that is vector has no fixed resolution". `image-loader.ts:194` then rasters
every SVG to a fixed 1024px longest edge. A full-width SVG prints at **248 dpi on
A6 and 176 dpi on A5** — the latter below the product's own `PRINT_DPI_WARN_BELOW`
of 200. Three surfaces stay silent about it, all for the same reason: the asset was
filtered out before measurement.

## What this changes in the plan

Three of the seven are cheap and belong _before_ the phase they threaten:

- **A4 before step 2.** The gate must not bless artwork that prints rotated.
- **A3 before step 5.** The re-export makes the blow-up an OOM rather than a
  nuisance.
- **A1 + A2 before step 7.** Retiring Browser print makes this engine the only
  route to a printed card; it should not be killable by one bad file first.

A5 and A6 are independent two-to-ten-line fixes that are easiest to land now and
hardest to spot after step 4 rewrites the print path. A7 is a genuine question for
step 2's pure definition — what does it say about vector art? — rather than a bug
to fix in isolation.
