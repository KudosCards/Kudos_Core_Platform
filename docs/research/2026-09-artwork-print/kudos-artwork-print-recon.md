# Kudos card artwork — full recon, root cause, and plan

Repo: `KudosCards/Kudos_Core_Platform` at `d06c5e2`, read end to end along the artwork path (upload → document → save → order snapshot → print run → PDF / browser print), then re-planned for the printer you have (§4, Canon imagePROGRAF PRO-310). Every claim points at a file, and the numbers are reproduced by tests in the attached patch.

Deliverables alongside this file:

- `artwork-print-integrity.patch` — the code changes as **two commits** (the artwork gate; the PRO-310 print pipeline), apply with `git am` on a branch. Typecheck, lint, Prettier, the full API unit suite (972 tests) and the full web suite (221 tests) are green; the API's e2e suite needs Postgres and could not run here, so run `pnpm --filter @kudos/api test:e2e` after applying.
- `kudos-borderless-calibration.pdf` — a test print with edge rulers; page 1 is the A5-landscape sheet you actually print. For §5 Phase 2.
- `kudos-sample-folded-a5.pdf` — what the new print-ready PDF looks like: one card, two A5 landscape pages (outside, inside), printed footer with QR and logo, drawn for a 2 mm borderless overhang.
- `docs/card-artwork-print-integrity.md` is inside the patch — the same findings and plan written in the repo's own house style, so the code comments have something to point at.

---

## 1. What is actually happening in the screenshot

The card is _Happy Birthday – Happy Tulips copy_, a saved copy of a catalog template. Its front is a page **background** (not an image element — `apps/api/src/catalog/card-document.util.ts`), and a background is drawn full-bleed and centre-cropped to the card's shape by every renderer:

| renderer               | file                                                     | rule                                   |
| ---------------------- | -------------------------------------------------------- | -------------------------------------- |
| editor + every preview | `apps/web/src/components/page-background.tsx`            | `coverCrop` into 450 × 634             |
| print-ready PDF        | `apps/api/src/print-pdf/render.ts` `drawImageBackground` | pdfkit `cover` into the 105 × 148 page |
| the number on screen   | `packages/shared-types/src/card-crop.ts` `coverCropLoss` | same comparison, same direction        |

The three agree (preview vs. PDF differ by 0.06 mm) and all three are correct: a background _should_ fill the card without distortion. The crop is not a rendering fault. **The artwork is 2:3 and the card is 1:1.4095**, so 6 % of the height — 4.46 mm off the top and 4.46 mm off the bottom — is discarded. That is the sun's hat in your screenshot. Your team already measured this: 207 of 217 catalog designs are authored at 2:3 (`docs/card-artwork-shape-plan.md`). The banner in the screenshot ("1 background image in this run is cropped… Artwork loses nothing at 1240 × 1748") is that plan's Phase 2 doing its job.

**No code change removes this crop.** A 2:3 image cannot fill a 1:1.41 card without losing 6 % of its height, gaining 3.2 mm white bars down each side, or being stretched. The fix for the catalog is the re-export (§5, Phase 1), and the crop gate that keeps it fixed already exists (`catalog-crop-gate.service.ts`) — it is just switched off until the re-export lands.

Everything else in this document is about the question you actually asked: **how do we make sure artwork uploaded in future can never reach print cropped or resized.** Reading the code for that turned up four things the two earlier plans did not cover, one of them a live defect.

---

## 2. Findings beyond the catalog crop

### F1 — "Upload your own artwork" has been squashing and stripping every custom upload (defect)

`apps/web/src/app/(app)/designs/designs-client.tsx` lines 50–95 (before the patch):

```ts
const CARD_WIDTH = 450;
const CARD_HEIGHT = 600;   // ← the canvas has been 634 since ADR 0161
…
elements: [{ kind: "image", x: 0, y: 0, width: 450, height: 600 }]
```

Two consequences, both silent:

1. **A 34-unit (≈ 7.9 mm on A6) white strip along the bottom of the front** of every design created by this flow. This is exactly the regression ADR 0161 records fixing for the _catalog_ builder ("a ~34 px blank strip along the bottom of every Airtable card"); the custom-artwork builder in a different file was never touched.
2. **The artwork is distorted.** An image _element_ is stretched to its box on both renderers (Konva `<Image width height>`; pdfkit `doc.image(…, { width, height })` — `render.ts` line 351). So an upload of any shape is forced into 3:4. A customer who did everything right and uploaded 1240 × 1748 got it squashed 5.7 % vertically, then the strip under it. No check anywhere measured distortion, and the ops crop banner deliberately excludes elements ("an image element… scales rather than losing its edges" — true, but it loses its proportions instead).

This is the only path a Pro/Centre customer has to make a card from their own full-face artwork, so it is the path your question is really about.

### F2 — Nothing enforces anything on a customer's background

The upload is browser → Supabase Storage on a signed URL (`storage.service.ts` `createSignedUpload`). The API never sees the bytes. The only server-side check a document passes on the way to storage is `SavedDesignsService.parseDocument` (zod shape + the reserved-footer rule, ADR 0171). The editor's crop note, the low-DPI note, the ops pre-flight banner are all advisory. `DesignAsset.width/height` are whatever the browser posted (`design-assets.service.ts`), unverified. So a wrong-shaped or low-resolution background can be saved, ordered, snapshotted onto the order line (ADR 0242) and printed, and the first time anyone can _stop_ it is an operator reading the print-run banner.

### F3 — EXIF orientation is measured wrong

Phone photos are commonly stored landscape with an orientation tag. Chrome/Safari/Firefox honour it (`image-orientation: from-image` default); pdfkit 0.19 honours it (`parseExifOrientation` in `pdfkit.js`, swaps width/height for orientations > 4); **`sharp.metadata()` does not** — it reports the header size and a separate `orientation` field. The catalog sync (`catalog-sync.service.ts` line 606) and the artwork measurement it stores use the header size. A rotated portrait photo of exactly the right shape therefore reads as landscape and "47 % cropped", while the browser's `naturalWidth/Height` (used by the editor and ops banner) says it is fine. Two surfaces, two answers. Not the cause of today's crop, but it will be the cause of a false refusal the day a gate is switched on.

### F4 — Image elements can be distorted with no warning

ADR 0069 made aspect-ratio lock the _default_, not a rule. A lock switched off, a legacy design, or F1 stretches an image and nothing in the editor, the pre-send check or the print run says so. There was no distortion measure in `shared-types` at all.

### Things I checked that are fine (so you don't spend effort on them)

- `coverCrop` / pdfkit `cover` / `coverCropLoss` agree, and pdfkit's `cover` centres correctly (checked against `pdfkit@0.19.1` source, not the docs).
- The print engine itself: text is vector in the embedded font, images are embedded at source resolution, the reserved back footer is clipped at page level. (What it _emitted_ — one A6 face per page — was the wrong shape for your printer; see §4.)
- The order snapshot (ADR 0242) means the artwork that prints is the artwork that was bought.
- Catalog originals are stored byte-for-byte from the Airtable attachment URL (not a thumbnail), so re-exported masters will reach print at full resolution.
- `CARD_HEIGHT = 634` vs. the true 634.29: 0.04 mm. Leave it (shape plan D7 is right).
- Thresholds: `CROP_OK_BELOW = 2 %` forgives a true-A6 export against the 634 canvas (0.06 %). `PRINT_DPI_WARN_BELOW = 200`. Both are sound and are what the new gate reuses, so there is one definition of "acceptable" for your artwork and the customer's.

---

## 3. The decision and what the patch does

You chose **enforce at upload**. Concretely, for a _background_ — the thing that _is_ the card — the rule is now:

> A background must be within 2 % of the card's shape and at least 200 dpi across the card (827 × 1165 on A6). The one number to give anyone producing artwork is **1240 × 1748** (A6 @ 300 dpi), or **1748 × 2480** for a master that is also 300 dpi on A5.

It is applied **twice**, from **one** pure definition (`packages/shared-types/src/card-artwork.ts`, `backgroundArtworkVerdict`):

1. **Before the upload starts.** Both places a customer can set a background — "Upload your own artwork" on `/designs` and the Background → Image control in the editor — now read the chosen file's pixel size in the browser and refuse _before a byte is sent_, with a message that names the loss and the size to export at:
   > This image is 1000 × 1500 pixels, which is not the card's shape: 6 % of its height (about 4.5 mm off each of the top and bottom) would be cut off to fill the card. Export it at 1240 × 1748 pixels (A6 at 300 dpi) and upload that.
2. **At the save**, server-side, so the browser cannot be bypassed (a stale tab, a forged request, a library asset uploaded before the rule, a future surface that forgets). `ArtworkGateService` (`apps/api/src/saved-designs/artwork-gate.service.ts`) is called from `SavedDesignsService.parseDocument` — the same choke point ADR 0171 chose for the reserved footer, for the same reasons. It fetches the file header from storage (host-allowlisted to `SUPABASE_URL`, same SSRF discipline as the print engine), reads it with `sharp.metadata()`, **applies EXIF orientation** (F3), and refuses with a 400 carrying the same message.

Three deliberate scoping choices, each with a test pinning it:

- **Only backgrounds new to the design are judged** (`newMemberBackgroundUrls`). A background the design already carried was accepted once; refusing it on a later save would trap a customer in a design they can neither fix nor keep. Catalog artwork is skipped — it is gated at the sync, and until the re-export lands most of it would fail here, which would stop a customer saving a text edit on artwork that is not theirs to change.
- **Fail open on infrastructure, closed on artwork.** If storage is unreachable or the bytes are not an image, the save proceeds with a warning in the log. The pre-upload check has already had its say; a storage blip must not stop every customer saving every design. A file that _is_ measured and is wrong is refused.
- **Elements are warned, not refused.** ADR 0162's reasoning stands: a small logo is a legitimate element and never loses its edges. What it can lose is proportions, so the patch adds `elementDistortion` and the editor now shows "⚠ This image is stretched 6 % out of shape" with a one-click **Restore proportions** whenever a distorted image is selected. Making that a hard refusal is a product call I have left to you (see §6).

And the defect: `customArtworkDocument` replaces the 450 × 600 element with a **full-bleed front background** — undistorted, locked under the customer's text, and measured by the gate like everything else.

### Files in the patch

| file                                                                | change                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared-types/src/card-artwork.ts` (new)                   | `backgroundArtworkVerdict`, `orientedPixelSize`, `elementDistortion` + `DISTORTION_OK_BELOW`, `customArtworkDocument`, `newMemberBackgroundUrls` — pure, no I/O                                                                                                                                        |
| `packages/shared-types/src/index.ts`                                | export it                                                                                                                                                                                                                                                                                              |
| `apps/api/src/common/card-artwork.spec.ts` (new)                    | 27 tests: the 2:3 export refused with "6 % of its height / 4.5 mm / 1240 × 1748"; 1240 × 1748 and 1748 × 2480 accepted; 620 × 874 refused at 150 dpi; 200 dpi floor; rotated phone photo passes only when oriented; the 450 × 600 box measured as a 5.7 % squash; the new document never carries a 600 |
| `apps/api/src/saved-designs/artwork-gate.service.ts` (new)          | the save-time gate: allowlisted fetch, sharp header read, orientation, per-URL memo, fail-open                                                                                                                                                                                                         |
| `apps/api/src/saved-designs/artwork-gate.service.spec.ts` (new)     | 11 tests with real PNG/JPEG fixture bytes generated by sharp, including EXIF orientation 6, the metadata-IP SSRF URL, and "measures each URL once"                                                                                                                                                     |
| `apps/api/src/saved-designs/saved-designs.service.ts`               | `parseDocument` is async and takes `previous`; `create` (both branches) and `update` (reads the stored document first) call the gate                                                                                                                                                                   |
| `apps/api/src/saved-designs/saved-designs.module.ts`                | provide `ArtworkGateService`                                                                                                                                                                                                                                                                           |
| `apps/web/src/lib/image-natural-size.ts`                            | `readFileNaturalSize(file)`                                                                                                                                                                                                                                                                            |
| `apps/web/src/app/(app)/designs/designs-client.tsx`                 | measure → refuse → upload → `customArtworkDocument`; the 450/600 constants are gone                                                                                                                                                                                                                    |
| `apps/web/src/app/(app)/designs/[id]/edit/design-editor-client.tsx` | the same pre-upload refusal for a page background; distortion warning + "Restore proportions" in the image panel                                                                                                                                                                                       |
| `docs/card-artwork-print-integrity.md` (new)                        | the plan, in-repo                                                                                                                                                                                                                                                                                      |

Verification run here: `tsc --noEmit` clean on api and web; eslint clean on touched files; Prettier clean; `jest` in `apps/api` 86 suites / 952 tests passing (including the repo's own guard scans such as `no-bare-fetch` and `card-artwork-single-source`); the four `design-editor*` web suites passing. **Not run:** `test:e2e` (needs Postgres). The e2e fixtures use `cdn.example.com` and `example.com` backgrounds, which the gate leaves unmeasured (not our storage host), so I expect them to pass unchanged — but please confirm.

One thing to know when you apply it: Prisma's engine download was blocked from this sandbox, so I generated the client with `--no-engine` for typechecking only. Nothing in the patch touches the schema.

---

## 4. The printer changes the plan — Canon imagePROGRAF PRO-310, A5 blanks folded to A6

You told me the cards are printed on a **PRO-310** onto **300 gsm A5 "Extra White Smooth" card blanks** that fold to A6, borderless, with the back's QR printed in-house (sometimes as a bulk batch out of house). Checked against Canon's own specification and driver manual, that changes three things — and the second commit in the patch implements all three.

**What the printer is.** A ten-ink pigment (LUCIA PRO II, incl. Chroma Optimizer) A3+ photo printer, 4800 × 2400 dpi. Top-feed takes specialty media up to 380 g/m²; the manual-feed tray takes 0.1–0.6 mm but only from 203 × 254 mm up, so **A5 card feeds from the top tray** (300 gsm is inside its range; one sheet at a time for thick card). **Duplex is manual** — the driver prints one side, asks for the stack back, prints the other. Borderless is supported on A5, A4, A3, A3+, B5, B4, 4×6", 5×7", 5" square, 7×10, 8×10, 10×12, 11×14, 12×12 and 13×19 — **not A6**, and custom sizes cannot be borderless. Canon's manual: borderless works by enlarging the image so it "extends slightly off the paper"; the "Amount of Extension" slider sets how much (recommended: second from the right), and "slight cropping may occur at the edges". It also warns that on some media "print quality may deteriorate at the top and bottom of the sheet".

**F5 — The PDF was the wrong shape for the printer.** The engine emitted one A6 face per page at exact trim. There is no borderless A6 on this printer, so the only way to print that file onto A5 blanks was the driver's 2-up page layout — which pairs pages in file order (front | inside-left, then inside-right | back), the wrong pairing for a folded card, and which Canon drivers typically cannot combine with borderless. Whatever you have been doing to make that work, it was work the software should have done.

**F6 — Borderless enlargement is an edge crop nothing in the software could see.** The driver scales the page by a factor and drops the overhang. On a 210 mm sheet at a typical 1–3 mm extension that is 1–3 mm gone from each long edge and proportionally from the short — the same symptom as the artwork crop, from a different cause, and it happens to every card including a perfect 1240 × 1748. Adding bleed _around_ the page cannot help: content outside the PDF's page box never reaches the driver.

**F7 — The reserved footer can be ours to print.** The stock is blank and you print the QR yourselves, so the 30 mm strip does not have to be clipped and printed in a separate pass; the engine can lay it down with the artwork, in register, from the card's own message-page link.

### What the second commit does

|                | before                                      | after                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout         | one A6 face per page                        | **`folded-sheet`**: per card, page 1 = outside (back \| front), page 2 = inside (inside-left \| inside-right), on one 210 × 148 landscape sheet — A5, a size the PRO-310 prints borderless. Odd/even page order is exactly what the driver's manual duplex expects. A front-only design still gets a blank inside sheet. `face-per-page` remains as an option.                         |
| Borderless     | exact trim, driver enlargement crops 1–3 mm | **`borderlessExtensionMm`** in the print profile, read off the calibration print: the engine draws each card fractionally smaller and centred so that _after_ the printer's enlargement the trim lands exactly on the paper edge and what falls off is background. Pinned by a test that scales the page about its centre by the printer's factor and checks the trim edge lands at 0. |
| Back footer    | always clipped (pre-printed stock assumed)  | **`backFooter: "print"`** draws the strip in-house: white band, this card's QR, "Scan to see your message", the Kudos logo. `reserved` (clip) stays for pre-printed or out-of-house QR batches.                                                                                                                                                                                        |
| Where it's set | —                                           | one **print profile** (`layout`, `backFooter`, `borderlessExtensionMm`): `GET/PUT /admin/print/profile`, a "Print setup" panel next to the existing print-size setting (super-admin gated, same guard scan). Layout and footer can be switched per run in the print overlay; the extension cannot — it belongs to the printer, not the run.                                            |

Files: `apps/api/src/print-pdf/geometry.ts` (`sheetGeometry`, `sheetCropMarks`), `render.ts` (`renderCardsPdf`, `FacePlacement`, `drawPrintedFooter`), `packages/shared-types/src/print-profile.ts`, `apps/api/src/print-profile/*`, admin controller/DTO, `print-run-pdf.service.ts` + DTO + controller, `apps/web/.../print-run-overlay.tsx`, `admin/print-size-setup.tsx`, `fulfillment/page.tsx` + client. Tests: 7 geometry cases, 7 render cases (page sizes read back from the PDF's MediaBoxes), 4 profile-service cases, 2 PDF-service cases, 3 overlay cases.

The default profile is `folded-sheet` / `reserved` / `0 mm`, i.e. the PDF button now produces the A5 sheets straight away, and the footer and extension are opt-in until you have calibrated and decided.

## 5. The plan

Ordered by how much printed-card quality each step buys. Phase 0 is the patch.

### Phase 0 — Apply the patch (this week)

Gate on, custom-upload defect fixed, distortion visible, and the print run produces imposed A5 sheets. Apply, run e2e, deploy. From this point no _new_ customer background can reach print cropped or soft, and the PDF is the sheet you actually feed.

### Phase 1 — Re-export the catalog and close its gate (the fix for the screenshot)

1. Re-export all 217 designs at **1748 × 2480 px** (A5 @ 300 dpi). Same shape as A6, and it prints at 300 dpi on either size; 1240 × 1748 is only 213 dpi on A5.
2. Re-attach in Airtable, run the sync, and confirm the sync summary's `cropped` list is empty.
3. Turn on `catalog_reject_cropped_artwork` (the `crop-gate` endpoints on the catalog controller, backed by `CatalogCropGateService`). From then on a wrong-shaped attachment is refused at the sync with the same message the customer gets.
4. Ops re-sync (ADR 0242's "Refresh artwork") any unprinted orders that reference the old artwork; printed cards are printed.

### Phase 2 — Calibrate the PRO-310 and set the profile (30 minutes, no code)

1. Print `kudos-borderless-calibration.pdf` page 1 (the A5 landscape sheet) on the real blanks from Acrobat or Preview: "Actual size", Borderless on, media type as you print cards, Amount of Extension where you normally leave it. Read the loss on the **long** edges off the rulers (instructions are on the page). Repeat once with the slider at its minimum and keep whichever setting you'll standardise on.
2. Admin → Print setup: layout **Folded sheet**, borderless overhang = the number you read, back footer **Printed with the card** (or **Pre-printed** while a bulk QR batch is in use).
3. Print one real card: Download print-ready PDF → print odd pages, reload, print even pages (or the driver's "2-sided (Manual)") → fold. Check the fold lands on the centre and the front reaches all four edges with nothing important cut. If the media type you use isn't in Canon's list, note the manual's line: for Matte Photo Paper / Premium Fine Art / Photo Paper Pro Premium Matte, full-page borderless needs "Cancel the safety margin regulation for paper size" ticked in Print Options.

### Phase 3 — Colour management for pigment ink on third-party card

The PRO-310 is a serious pigment printer and the blanks are not a Canon media, so the driver's built-in profiles are a guess and matte card can print flat. Three steps, in order of payoff: (a) pick the closest Canon media type (Matte Photo Paper is the usual match for smooth card) and print a test card; (b) if colour is off, get an ICC profile for the stock — a printed target and a profiling service, or ask the blank's supplier for one — and select it in the driver with "Printer manages colours" off; (c) normalise every raster to sRGB in `decodeImage` (`sharp().toColourspace("srgb").withMetadata({ icc: "srgb" })`) so a JPEG saved in Adobe RGB or CMYK doesn't print with the wrong assumptions. Canon's Professional Print & Layout app is for images, not PDFs — print the PDF from Acrobat/Preview through the driver.

### Phase 4 — Orientation in the catalog sync

`copyImage` → `measurePixels` (`catalog-sync.service.ts` ~line 603): pass `{ width, height, orientation }` through `orientedPixelSize` and persist `artworkWidth/Height` oriented. One-line change plus a test with a rotated JPEG (the fixture helper is in `artwork-gate.service.spec.ts`).

### Phase 5 — Distortion at the point of sale

A design-level finding in the pre-send check (`preflight.ts`, the same shape as `backArtworkClipped`): "an image on the front is stretched 6 % out of shape". Catches every legacy design from the old upload flow before payment, not only when someone happens to select the image in the editor. Server-authoritative, so it runs on all three order paths.

### Phase 6 — Browser print: retire it

`Browser print` insets the card 5 mm on every side for a printer that leaves a margin (`fittedCardMm`, `PRINT_SAFE_MARGIN_MM`), one face per page, unimposed. The PDF is now a folded A5 sheet with the extension modelled; the two outputs no longer resemble each other and an operator can print the wrong one. Remove the button. Low effort; removes a foot-gun.

### Phase 7 — Measure at upload, once, server-side

`POST /design-assets` records the browser's word for `width/height`. Have the API measure the object itself on that call (the gate's `measure()`, persisted onto the row) so the "Your uploads" picker can grey out a background that would be refused _before_ the customer picks it, and so `DesignAsset` becomes a trustworthy index of what is printable.

---

## 6. Decisions I left for you

1. **Should a distorted image element block the save** (like the reserved footer does) or only warn (as the patch does)? Blocking is one line in `parseDocument` once Phase 4's pure check exists; the cost is refusing a customer who stretched something on purpose with the lock off.
2. **Legacy custom-artwork designs.** Every design created by the old upload flow still carries a 450 × 600 element and prints squashed with the strip. Options: leave them (the editor now flags it on selection; Phase 4 flags it at checkout), or a one-off migration that converts a front consisting solely of a full-card image element into a background. The migration is mechanical and reversible; say the word and I'll write it.
3. **The printed footer's layout.** I've drawn QR (18 mm) left, caption, logo right, in the 30 mm band. If the pre-printed batches use a different arrangement, tell me the measurements and I'll match them so a printed and a pre-printed card are indistinguishable.
4. **Master size for the re-export:** 1748 × 2480 (my recommendation — covers A5) vs. 1240 × 1748 (the number already in the UI). If you go with 1748 × 2480, the UI copy in `idealArtworkPixels` messages still says 1240 × 1748 for A6, which is correct for A6; nothing needs changing.

---

## Appendix — the pipeline, as read

```
file on disk
  └─ browser measures (readFileNaturalSize)  ── refuses wrong shape / low dpi   [patch]
     └─ POST /uploads/design-assets → signed URL → PUT to Supabase (API never sees bytes)
        └─ document: background {type:"image"} (custom + catalog) | element {kind:"image"} (photos/logos)
           └─ POST/PATCH /saved-designs → parseDocument
                 zod → reservedFooterViolation (ADR 0171) → ArtworkGateService   [patch]
              └─ order created → OrderRecipient.documentSnapshot (ADR 0242)
                 └─ ops print run (fulfillment.service.printRun)
                    ├─ Download print-ready PDF → renderCardsPdf(profile)            [patch]
                    │     folded-sheet: 210×148 outside (back|front) + inside (L|R)
                    │     borderlessExtensionMm: trim drawn at w/k, centred        (Phase 2)
                    │     backFooter print: QR + caption + logo in the 30 mm strip
                    │     background: pdfkit cover → face box     elements: stretched to box
                    └─ Browser print → Konva, card inset 5 mm, unimposed            (Phase 6: retire)
                       └─ Canon PRO-310, A5 300gsm blanks, borderless, manual duplex, fold
```
