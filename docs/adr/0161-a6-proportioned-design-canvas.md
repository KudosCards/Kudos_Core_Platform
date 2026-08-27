# 0161 — A6-proportioned design canvas (editor is WYSIWYG against print)

## Status

Accepted — implemented.

## Context

Customers reported that a card looked different once printed: everything they
laid out in the editor appeared **shifted down** on the printed PDF, with a band
of blank space injected above the content.

The cause was an aspect-ratio mismatch between where cards are _authored_ and how
they are _printed_, not distortion:

- The design canvas was authored at **450 × 600** design units — a **3:4**
  proportion (`CARD_HEIGHT / CARD_WIDTH = 1.333`). Content is top-anchored and
  fills the editor frame.
- We print on **ISO A6** paper, **105 × 148 mm** — a **1:√2** proportion
  (≈1.409), which is _taller_ than 3:4.
- `fittedCardMm()` fits the 3:4 artwork onto the A6 page by width (keeping a 5 mm
  print safe margin), then the print overlay **vertically centres** the fitted
  card in the full A6 page. Because the 3:4 card is shorter than A6, this centring
  injected **~10 mm of blank space at the top** (and bottom) of the sheet.

So "on-screen preview = printed output" held (both used the same fit), but
"editor = printed output" did not — the editor frame was a different shape from
the page. For a business that sells **A6 cards**, the right fix is to author on an
A6-shaped canvas rather than change the physical product size.

## Decision

Make the design space **A6-proportioned** so the editor is genuinely WYSIWYG
against print, keeping the card a true A6.

- `CARD_HEIGHT` in `@kudos/shared-types` `design-layout.ts` changed **600 → 634**.
  `450 × 148/105 ≈ 634`, so the canvas matches A6's 105:148 proportion to within
  0.1 mm. `CARD_WIDTH` is unchanged at 450.
- Everything downstream derives from this single constant and updates
  automatically: the editor Stage, safe-area frame and snap guides
  (`design-canvas.tsx`), every read-only `CardFacePreview`, the page background
  fill (`page-background.tsx`), the review-tile placeholder, and the print fit
  (`fittedCardMm`). No per-document migration is needed — element coordinates are
  unchanged; the canvas simply gains the correct amount of height, and existing
  top-anchored designs keep their layout with a little more room at the bottom.
- `fittedCardMm` now fits an A6-shaped card onto the A6 page, so the fitted card
  nearly fills the safe area with **no content-shifting letterbox**. The only
  residual is a couple of millimetres of symmetric slack from the fixed 5 mm safe
  margin — the legitimate print border, not the old asymmetric downward shift.
- Two UI wrappers that box a **live** `CardFacePreview` were moved from
  `aspect-[3/4]` to `aspect-[105/148]` so they don't clip the now-taller preview:
  the saved-design gallery tile (`designs-client.tsx`) and the editor's loading
  placeholder (`design-editor-client.tsx`).

### Why A6 exactly (not true √2)

A6 is the **house/default** print size (`DEFAULT_CARD_SIZE`, see ADR 0138), so
the canvas is matched to it precisely. A5 (our secondary size) has a marginally
different rounded proportion (148:210), leaving a sub-2 mm residual letterbox on
A5 runs — invisible in practice, and `fittedCardMm` still clamps on both axes so
the fit is never distorted at any size.

## Follow-up: catalog full-bleed artwork (fixed)

The visual pass over catalog templates surfaced a real regression the taller
canvas exposed. `buildCardDocument` (Airtable catalog → editable document) placed
the artwork as a full-bleed **image element with a hard-coded `height: 600`**, not
as a page background. On the 634-tall canvas that left a ~34 px blank strip along
the bottom of **every** Airtable card. Bumping the element to 634 wasn't an option
— an image element stretches to its box, which would distort the art.

Fix: the artwork is now a page **`background`** of type `image`. `PageBackground`
draws backgrounds to the real `CARD_WIDTH × CARD_HEIGHT` and cover-crops them
(`coverCrop`), so the artwork stays full-bleed and undistorted at any proportion,
now and if the canvas ever changes again. As a background it's also locked, which
suits the "pick, then edit" model (ADR 0011) — a customer adding text on top can't
grab or move the artwork. The catalog e2e assertion was updated to check
`front.background` instead of `front.elements[0]`.

Existing catalog rows carry the old element-form document until re-synced; the
sync rebuilds each document via `buildCardDocument`, so the next scheduled pull
(or an ops "Refresh catalog") repairs them. No data migration is required.

## Follow-up: card-tile shape consistency (done)

With the live previews on the A6 canvas, the raster **catalog thumbnail tiles**
(`thumbnailUrl` — external Airtable product images) were left at `aspect-[3/4]`,
so browse surfaces mixed 3:4 tiles with A6-shaped live previews on the same page
(e.g. `/designs`). Those wrappers were subsequently re-boxed to `aspect-[105/148]`
so every card tile reads as the same true-A6 shape: `template-picker-modal`,
`cards-gallery`, the `/cards/[id]` and `/cards/[id]/send` hero previews, the
basket thumbnail, and the designs "Templates" grid.

They keep `object-cover`, so nothing distorts — the box just changed proportion,
which shifts the crop from top/bottom to a few percent off the sides for any
still-3:4 source image. This is purely cosmetic (no print or correctness impact);
a catalog thumbnail regen off the now-full-bleed artwork would make the tiles
pixel-tight, but isn't required.

## Consequences

- What a customer lays out is what prints — the reported top-shift is gone.
- Existing saved designs and Airtable-authored templates remain valid; their
  content stays put and gains a little bottom room. A visual pass on
  bottom-anchored template decoration is worthwhile but low-risk.
- `fittedCardMm` behaviour is now pinned by unit tests
  (`apps/api/src/common/card-format.spec.ts`): aspect is preserved, the fit stays
  inside the safe margin, and the A6 top slack is asserted `< 3 mm` (a regression
  guard against reintroducing the ~10 mm 3:4 letterbox).
