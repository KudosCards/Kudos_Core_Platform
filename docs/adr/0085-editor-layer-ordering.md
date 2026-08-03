# 0085 — Card editor: layer ordering (z-index controls)

## Status

Accepted

## Context

The final Phase 1 gap versus a consumer editor (Moonpig): once two elements
overlapped, there was no way to control which sat on top. The stacking order was
whatever order elements were added — fixed, with no bring-forward / send-back.

Crucially, the stacking order is **already** represented: the canvas and every
preview draw `page.elements` in array order, so a later element renders on top.
Layer ordering is therefore purely *reordering that array* — no new field, no
z-index property, no migration.

## Decision

Add bring-forward / send-back layer controls that reorder the element within its
page's array.

1. **Pure reorder helper in shared-types** (`reorderElement` + `LayerMove`).
   Given the array, an element id, and a move (`forward` / `backward` / `front` /
   `back`), it returns a new array with the element restacked; it's a no-op order
   when the element is missing or already at the relevant end, and never mutates
   the input. Generic over `{ id }` so it stays decoupled from the element union.
   Unit-tested for all four moves, both no-op ends, the missing-id passthrough,
   and non-mutation.

2. **Panel controls + keyboard shortcuts.** The side panel gains a "Layer" row
   (To back / Back / Forward / To front) for the selected element, with the
   ends disabled when already frontmost/backmost so a no-op reads as unavailable.
   Keyboard: ⌘/Ctrl+] forward, ⌘/Ctrl+[ backward, add Shift for front/back —
   matching the Figma/Moonpig convention, wired into the existing editor keydown
   handler (still ignored while typing in a field).

3. **No schema / renderer change.** Because array order already *is* z-order,
   nothing about the stored `DesignDocument` changes and the read-only preview
   needs no update — it already draws in array order. The Transformer and drag
   snapping keep working across a reorder: the Transformer effect already
   re-attaches on `page.elements` changes, and snapping re-queries the layer each
   drag.

## Consequences

- Overlapping elements can now be restacked, closing the last Phase 1 parity
  gap, via both discoverable buttons and power-user shortcuts.
- Zero data-model impact: the change is entirely a UI affordance over the
  existing array order, so every existing design keeps its current stacking.
- The reorder logic is pure and unit-tested rather than living in a React
  handler, consistent with the other editor helpers (bakeScale, computeSnap).
- Phase 1 (transform handles → snapping → layer ordering) is complete. Next is
  Phase 2: stickers/shapes, richer self-hosted fonts + bold/italic, per-page
  background, and canvas zoom.
