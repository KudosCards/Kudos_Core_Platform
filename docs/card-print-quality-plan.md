# The best card this printer can make

Three investigations now converge on the same path — the crop plan, the shape
plan, and two recons of artwork-to-print
(`docs/research/2026-09-artwork-print/`). This is the single plan that replaces
the loose ends of all of them, ordered around one question: **what does it take
for a Kudos card to be the best card a Canon imagePROGRAF PRO-310 can produce?**

Everything below is either verified against the code with a file and line, or
marked as a number only a test print can supply.

## The printer, and what it dictates

A ten-ink pigment A3+ photo printer, printing our own A5 300 gsm "Extra White
Smooth" blanks, folded to A6, borderless, manual duplex, with the back's QR
printed in-house. Four consequences, and each one is a constraint the software
has to meet rather than a preference:

1. **There is no borderless A6 on this printer.** A card face cannot be a page.
   The page has to be the **A5 landscape sheet** (210 × 148 mm) that folds to
   one A6 card. The engine emits one A6 face per page today
   (`apps/api/src/print-pdf/render.ts:7`), so the only way to print it has been
   the driver's 2-up, which pairs pages in file order — the wrong pairing for a
   folded card.
2. **Borderless prints by enlarging.** The driver scales the page up and lets
   the overhang fall off the paper. That is a crop of 1–3 mm per edge that
   happens _after_ the PDF, to every card, including artwork that is perfectly
   shaped. Adding bleed cannot help: content outside the page box never reaches
   the driver. The only fix is to draw the card fractionally smaller so the trim
   lands on the paper edge after the enlargement.
3. **Duplex is manual.** The operator prints one side, turns the stack, prints
   the other. Which axis they turn it about decides whether the inside comes out
   upright or upside-down, and nothing in the software or the calibration sheet
   currently tests that.
4. **The stock is not a Canon medium.** The driver's profiles are a guess for
   it, and a guess on a pigment printer is the difference between a flat card
   and a good one. Meanwhile pdfkit writes **no ICC profile at all**
   (`COLOR_SPACE_MAP` by channel count, `pdfkit.js:3810`), so any non-sRGB
   upload is already being reinterpreted as device RGB.

## Decisions

**D1 — The sheet is the unit of output, not the face.** The PDF's page becomes
the A5 landscape sheet the printer is fed: page 1 outside (back | front), page 2
inside (inside-left | inside-right). Verified correct for a left-hand fold
against the sample in `docs/research/2026-09-artwork-print/`. `face-per-page`
stays as an option for a future print house that trims.

**D2 — Compensate for the borderless overhang in the PDF, from a measured
number.** Not a guess and not a constant: an ops setting, read off a calibration
print, per printer. A wrong number here crops every card, so it stays opt-in at
0 mm until someone has measured it.

**D3 — Print the back footer ourselves.** The stock is blank and we print the QR
in-house, so the 30 mm strip can be laid down in register with the artwork
instead of in a separate pass. `reserved` (clip) stays for pre-printed batches.

**D4 — The engine must survive its inputs before it becomes the only engine.**
Today a corrupt PNG kills the API process outright — verified: `sharp`'s header
read passes, `doc.image()` returns without throwing, and png-js rethrows inside
a zlib callback that no `try`/`catch` on the path can see. Retiring the browser
print path (D10) makes this engine the only route to a printed card. It cannot
be killable by one bad file first.

**D5 — Enforce artwork shape and resolution at upload, from one pure
definition.** `packages/shared-types`, shared by the browser pre-upload check and
a server-side gate at the same choke point ADR 0171 uses. Fail **open** on
infrastructure (storage unreachable, bytes unreadable) and **closed** on
artwork that is measured and wrong: a storage blip must not stop every customer
saving every design.

**D6 — A measurement is only worth having if every surface takes it the same
way.** EXIF orientation is the live instance — the browser, `sharp` and pdfkit
each have a different answer, and a gate built on the wrong one refuses good
artwork and passes bad. Orientation is normalised at decode, before anything
measures or draws.

**D7 — Warn on distortion, block on the reserved footer.** The footer rule earns
the right to block because it has no false positives. Distortion has one —
deliberate stretching with the aspect lock off — so it warns in the editor and
becomes a design-level finding at checkout, where it is caught before money
changes hands.

**D8 — The catalog is fixed by re-exporting it, not by changing the renderer.**
A 2:3 image cannot fill a 1:1.4095 card without losing 6% of its height, gaining
white bars, or being stretched. The gate that keeps it fixed already exists
(`catalog-crop-gate.service.ts`) and is switched off until the re-export lands.

**D9 — Artwork masters are 1748 × 2480.** 300 dpi at A5, and ample at A6. The
one number to give anyone producing artwork. **This depends on P1 landing
first** — see D10.

**D10 — Bigger masters are only safe once the engine stops re-embedding them.**
pdfkit de-duplicates images only when `src` is a string; the engine passes
Buffers, so every page writes a fresh copy — measured at **30.9×** on fifty
pages of one image. At a 500-recipient run ceiling, re-exporting the catalog at
D9's size turns a slow run into an out-of-memory failure. Order matters here and
it is the one hard dependency in this plan.

**D11 — Retire the browser print path, last.** Once the PDF is an imposed,
overhang-compensated A5 sheet, the two outputs no longer resemble each other and
an operator can print the wrong one. It goes — but only after everything above
has been proved on real card, because until then it is the fallback.

## Phases

One PR each, merged green before the next starts. **P0 runs in parallel from
today** — it is someone standing at the printer, not code, and P4 cannot be
finished without its numbers.

### P0 — Calibrate the printer (no code, ~45 minutes)

Print `docs/research/2026-09-artwork-print/kudos-borderless-calibration.pdf` on
the real blanks. Regenerate it with `pnpm --filter @kudos/api calibration-sheet`
— the sheet is a generated artefact, and the script is the thing to edit when the
question changes.

**The paper size is the whole trick.** It must be **A5 borderless LANDSCAPE, 210
× 148**. Three attempts came back with a clean white border and every ruler
intact, which means borderless never engaged; the Page Setup on the last one read
"A5 Borderless 148 by 210 mm", which is _portrait_. A portrait page size cannot
match a landscape sheet, so the driver has nothing to expand and quietly falls
back to its ordinary margins. Scaling must be Actual size / 100%, never "Fit".

Then answer four questions, all of which the software or the process needs:

1. **How much does each edge lose — all four, separately?** At the middle of each
   edge, read the shallowest numbered step still visible. Write down TOP, RIGHT,
   BOTTOM and LEFT as four numbers, and say whether the opposite pairs match.

   The sheet used to ask for the long-edge figure alone, which silently assumed
   the loss was symmetric. The compensation scales the sheet about its centre, so
   that assumption is load-bearing: it corrects an even enlargement and cannot
   correct a sheet that is also fed off-centre (ADR 0249). One of the returned
   prints was visibly off-centre, so this is worth establishing rather than
   inheriting. Four matching numbers cost nothing and settle it; four that differ
   are the finding, not a measuring error.

   Before any of it: **is there any white paper outside the grey band?** If so,
   borderless did not engage and nothing else on the sheet means anything yet.

   This is D2's number. Repeat at the slider's minimum and keep whichever you
   will standardise on.

2. **Which way do you turn the stack?** Print any two-page document, mark the
   sheet asymmetrically, and record whether the second side comes out upright
   when flipped about the long edge or the short edge. This decides whether P4's
   inside pages need rotating, and nothing currently tests it.
3. **Does the fold crack?** 300 gsm with pigment ink laid over the crease may
   need scoring before folding. If it cracks, scoring becomes a step in the
   process, not a code change.
4. **How long before the second side?** Pigment on smooth card can offset if the
   stack is turned too soon. Record a dwell time.

Questions 3 and 4 are inference from the stock weight and ink type, not
something I can verify from here — which is exactly why they are on a test print
rather than in a decision above.

### P1 — The engine survives its inputs (D4, D10)

- A shared `MAX_ARTWORK_PIXELS`, and `limitInputPixels` on every `sharp()` call
  in `image-loader.ts` and `catalog-sync.service.ts`. Today every limit is a
  _byte_ limit; a 74-byte PNG declaring 16000 × 16000 passes both the bucket's
  10 MB and the loader's 25 MB and drives pdfkit's synchronous path into ~2 GiB.
- Stop handing undecoded customer PNG bytes to pdfkit. Re-encoding inside the
  existing `try`/`catch` turns the process-killing async throw into a caught
  rejection that resolves to `null`, like every other bad asset.
- An `uncaughtException` handler in `main.ts` that reports before exit, so a
  future async throw is at least attributable.
- Memoise `doc.openImage()` per asset URL so one image is embedded once per
  document rather than once per page.

**Falsifying checks**: the corrupt-IDAT PNG resolves to `null` and the run
completes; the 16000 × 16000 declaration is refused before pdfkit sees it; fifty
pages of one background produce a PDF within a few percent of one copy of it,
not thirty.

### P2 — Three small correctness fixes

Independent of the print pipeline, cheapest now, hardest to spot once P4 rewrites
the print path.

- **The custom-artwork document.** `designs-client.tsx:54` has `CARD_HEIGHT =
600` against a 634 canvas, so every upload through "Upload your own artwork" —
  the Pro/Centre path — is placed as a stretched 450 × 600 image _element_ above
  a 7.9 mm white strip. It becomes a full-bleed background, undistorted.
- **The reserved-footer block reads rotation.** `backArtworkInReservedFooter`
  never reads `rotation`, while the editor's advisory check is rotation-aware and
  the sibling module skips rotated elements on purpose. It currently refuses
  saves for art that is visibly above the line, and passes text that prints into
  the band.
- **The returned-card reprint keeps its message page.** The reprint copies the
  occasion, design, snapshot and postage class and drops `messagePageId`, so the
  replacement card's QR prints onto a freshly minted empty page — for the one
  recipient most likely to scan it.

### P3 — The artwork gate (D5, D6)

One pure definition in `shared-types`: within 2% of the card's shape, at least
200 dpi across the card, and within `MAX_ARTWORK_PIXELS`. Applied twice — refused
in the browser before a byte is sent, enforced server-side at `parseDocument` so
the browser cannot be bypassed. Only backgrounds _new to the design_ are judged,
and catalog artwork is skipped (it is gated at the sync, and until P6 most of it
would fail here).

**Orientation is normalised at decode first**, or the gate measures an upright
image and passes artwork that prints sideways: the transcode branch in
`decodeImage` drops EXIF, so a WebP phone photo shows upright everywhere and
prints on its side.

The definition also has to say what it means for **vector** art. It currently
exempts SVG on the grounds that vectors have no fixed resolution, while the
engine rasters every SVG to a fixed 1024 px — 248 dpi at A6 and 176 dpi at A5,
the latter below our own warning threshold. Either raster to the printed size, or
measure SVGs against the raster the engine will actually make.

### P4 — The sheet the printer takes (D1, D2, D3) — **done**, ADR 0249

Built, not the Cowork patch's second commit — that no longer applied, because
#455 rewrote `print-run-pdf.service.ts` and #457/#460 rewrote the fulfilment
client after it was cut.

- `folded-sheet` layout, **on by default**: outside (back | front), inside
  (inside-left | inside-right) on one 210 × 148 sheet, interleaved so every
  outside is an odd page. P0's flip answer applied: the operator turns the stack
  about the **short** edge, so nothing is rotated.
- `borderlessOverhangMm`, defaulting to 0 until measured, compensated by scaling
  the sheet about its centre by the exact inverse of the driver's enlargement.
- **No placeholder QR** on a sheet: a card with no message page gets a plain
  white band, not a fake QR beside the words "Scan to see your message".
- `backFooter: "print"` built and selectable, but **not the default** — the stock
  in the building is pre-printed, so drawing the strip would overprint it. It is
  switched on when blank stock arrives, after a proof.
- Print profile behind `GET/PUT /admin/print/profile`, super-admin gated.

**Falsifying check, still outstanding**: print one real card end to end — odd
pages, turn, even pages, fold. The fold lands on the centre, the front reaches
all four edges, and nothing important is cut.

**Still needed from the printer**: the borderless overhang. Three prints came
back with a clean white border and the full rulers intact, which means borderless
never engaged — the paper size was A5 _portrait_ while the sheet is landscape, so
there was nothing for the driver to expand. The sheet has been rebuilt landscape-
native with that named on it, a band that makes "did borderless engage?" a
one-second yes/no, and a four-edge reading instead of one figure. Until it
engages there is no number to enter, and 0 is the correct setting: cards print
full size, exactly as they do today.

One of the returned prints was also visibly **off-centre**. The compensation
scales about the sheet's centre and so assumes a symmetric enlargement; it cannot
correct an off-centre feed. That is why the reading is now per-edge — see
ADR 0249 and P0 above.

### P5 — Colour (D-none; it is simply wrong today)

- Normalise every raster to sRGB at decode (`sharp().toColourspace("srgb")`),
  because pdfkit discards the profile and the printer then reads Adobe RGB
  numbers as sRGB. This is a correctness fix, not a refinement.
- Pick the closest Canon media type and print a test card.
- If colour is still off, get an ICC profile for the stock — printed target and a
  profiling service, or the supplier's — and select it with "printer manages
  colours" off. On a ten-ink pigment printer this is the single biggest visible
  quality step in the whole plan.

### P6 — Re-export the catalog and close its gate (D8, D9)

Re-export all 217 designs at 1748 × 2480, re-attach in Airtable, sync, confirm
the summary's `cropped` list is empty, then switch on
`catalog_reject_cropped_artwork`. Ops re-sync any unprinted orders that reference
the old artwork. **Requires P1**, per D10.

### P7 — Measurement hygiene

- EXIF through `orientedPixelSize` in the catalog sync, so stored artwork
  dimensions stop disagreeing with every other surface.
- Distortion as a design-level finding in the pre-send check, alongside
  `backArtworkClipped` — catching every legacy design before payment rather than
  only when someone selects the image in the editor.
- Measure `DesignAsset.width/height` server-side at upload instead of trusting
  the browser, so "Your uploads" can grey out artwork the gate would refuse.

### P8 — Retire browser print (D11) — **gated**, not yet retired

D11's condition fired the moment P4 merged. The browser overlay still puts one
card face on one page; the PDF now puts two faces on a landscape sheet that folds
into a card. The two outputs no longer resemble each other, and the overlay's
pages cannot be folded into anything — two buttons side by side, one of them
now wrong.

So browser print is **disabled whenever the profile says `folded-sheet`**, with
the reason on the page rather than only in a tooltip, and the operator pointed at
the PDF. Gated rather than deleted, because `face-per-page` is still a selectable
profile and one face per page is exactly its output; the escape hatch stays
usable precisely when it is correct. A caller that has not been told the layout
gets the house profile's, which refuses.

The overlay remains the _content_ preview — the merged names, the artwork, what
the reserved strip covers — which is worth keeping whatever prints it. Making the
preview itself show imposed sheets is a separate piece of work and is not what
D11 asked for.

Retiring it outright stays open, and is cheaper now that nothing can print the
wrong shape.

## Out of scope, and why

- **Art-directed cropping.** Ruled out by the shape plan's D6 on evidence: the
  loss is uniform, small and symmetric, so a per-design crop offset would be a
  large build to choose _which_ 6% to discard when re-exporting discards none.
- **Changing `CARD_HEIGHT` to 634.29.** 0.04 mm, and it would reflow every design
  ever saved (shape plan D7).
- **A print-house path.** The bleed and crop-mark machinery stays in the engine
  and stays unused; this plan is about the printer in the room.

## What this does not fix

Every card already printed from a 2:3 design went out 8.93 mm short, and every
card from the custom-upload path went out squashed. There is no record of what
was lost, because nothing measured it. Reprints after P2 and P6 will be correct.
The cards in the post are not.
