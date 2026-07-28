# 0062 — Card editor guard rails against text overflow

## Status

Accepted

## Context

The card editor let designers place text freely on a 450×600 canvas. Text
already word-wrapped to the card's right edge (0033-era fix), but nothing
stopped it running off the **bottom**, and elements could be dragged almost
entirely off the card and "lost". There was no sense of where the printable
area ended, so it was easy to author a layout that looked fine on screen but got
clipped at print/trim. User feedback asked for guard rails / bounding boxes /
adjustable text width / editable margins so poor layouts can't happen by
accident.

## Decision

Add layout guard rails, with the geometry defined **once** in shared-types so
the editor, every read-only preview, and any future server render agree.

- **`packages/shared-types/src/design-layout.ts`** — the single source for card
  geometry and the guard-rail maths, all pure and unit-tested:
  - `CARD_WIDTH`/`CARD_HEIGHT` (450×600) and `CARD_SAFE_MARGIN` (24) — the
    printer safe area content should stay within.
  - `clampElementPosition(pos, size)` — clamps a dragged element's origin so it
    stays on the card; a known width/height keeps the whole box on, an unknown
    dimension (auto-height text) keeps at least a sliver on-card.
  - `isOutsideSafeArea(box)` — whether a rendered box strays past the margin.
  - `textWrapWidth(element)` — an element's wrap width: its explicit `width`, or
    the legacy distance-to-right-edge fallback. Replaces the duplicated
    right-padding calc that lived in both the editor canvas and the preview.

- **Schema** (`card.ts`): the text element gains optional `width` (the
  adjustable text box) and `align` (`left`/`center`/`right`). Both optional, so
  existing designs render exactly as before.

- **Canvas** (`design-canvas.tsx`):
  - A dashed **safe-area guide** frames the printable region.
  - Every element drags through `clampElementPosition` (via Konva
    `dragBoundFunc`, scale-aware) so nothing can be dragged off the card.
  - The selected text element shows a dashed **bounding box** sized to its
    measured extent; the box turns **red** and the editor panel shows a warning
    when the text spills outside the safe area.

- **Editor panel**: a **Text box width** control (with "Fit to card" to clear
  it) and left/center/right **alignment** buttons — the "adjustable text width"
  the feedback asked for.

Editable per-side margins were considered and **deferred**: the fixed safe-area
guide plus adjustable text width covers the actual failure mode (overflow)
without the extra UI surface. It can be revisited if designers need bleed
control.

## Consequences

- Text can no longer silently run off the card: it word-wraps within its box,
  the safe area is visible, and overflow is flagged before an order is placed.
- Elements can't be dragged off and lost.
- Card geometry and text-wrap logic live in one place; the editor and previews
  can't drift. Existing designs are unaffected (new fields optional).
