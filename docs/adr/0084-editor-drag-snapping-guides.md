# 0084 — Card editor: drag snapping + alignment guides

## Status

Accepted

## Context

ADR 0083 gave the editor on-canvas transform handles. The next gap versus a
consumer editor (Moonpig, our reference) was **alignment**: dragging an element
was free-floating, so centring it on the card or lining two elements up meant
eyeballing pixels or typing numbers. Every polished editor snaps a dragged
element to meaningful lines and shows a guide while it's aligned.

## Decision

Add **drag snapping with live alignment guides**, built on the same selection +
Konva foundation, with the maths extracted as a pure, unit-tested helper so it
isn't trapped inside browser-only canvas event handlers.

1. **Pure snap helper in shared-types** (`computeSnap`). Given the dragged box
   and candidate lines per axis, it tests the box's left/centre/right (x) and
   top/middle/bottom (y) against the lines and snaps to the closest match within
   `SNAP_THRESHOLD` (6 design units) per axis, returning the adjusted origin plus
   the guide lines to draw (at most one per axis). `cardSnapLines` supplies the
   card's own lines — the two edges, the two safe-area margins, and the centre.
   Both are pure, so they're covered by unit tests (nearest-of-several, exactly
   on a line, just outside the threshold, no-snap passthrough) without a browser.

2. **Canvas wiring via a shared drag bridge.** On drag start the canvas gathers
   the snap targets once — the card lines plus every *other* element's
   edges/centres, measured in real design units via
   `node.getClientRect({ relativeTo: layer })` (so text uses its actual rendered
   box, not an estimate). On each drag move it snaps the node by the computed
   delta and shows the guide lines; on drag end it clears them. All three node
   types (text/image/QR) share this bridge and still commit their own x/y in
   `onDragEnd`, so nothing about how geometry is stored changes.

3. **Guides are non-persistent, non-interactive.** They're thin Konva `Line`s
   drawn only during a drag and never written to the `DesignDocument` — purely a
   placement aid. **No schema change**, no renderer parity concern (the read-only
   preview never drags), so `card-face-preview.tsx` is untouched.

4. **Alt to bypass.** Holding Alt while dragging skips snapping for free
   placement, matching the convention in other editors; surfaced in the panel's
   shortcut hint.

## Consequences

- Centring an element on the card, sitting it flush to the safe frame, or lining
  elements up now "clicks" into place with a guide line — the biggest remaining
  "feels professional" gap closed, with an Alt-to-disable escape hatch.
- The snap logic is pure and unit-tested; the canvas only supplies measured
  boxes and draws lines. Re-measuring sibling boxes at drag start (not every
  frame) keeps the per-move work to one `getClientRect` + the pure calc.
- Scope is deliberately **drag** snapping. Snapping during a Transformer *resize*
  is a natural follow-on but more involved (anchor-aware) and left for later.
- Follow-on Phase 1 items still open: layer ordering (z-index controls). Then
  Phase 2+ (stickers, richer fonts + bold/italic, per-page background, zoom).
