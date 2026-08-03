# 0090 — Card editor: canvas zoom

## Status

Accepted

## Context

The final planned editor item toward Moonpig-parity. The canvas fitted the card
to the column width, but there was no way to **zoom in** for fine placement of a
small element (nudging a sticker, aligning text against a background). Every
consumer editor lets you zoom.

## Decision

Add a user zoom factor layered on top of the existing fit-to-width scale.

1. **Zoom multiplies the fit scale.** The canvas already computed a
   `fitScale` (from a ResizeObserver on the canvas column, capped so a wide
   screen doesn't let the card dominate). Zoom is a separate factor, and the
   Stage's effective scale is simply `fitScale × zoom`. Crucially, every
   coordinate conversion in the canvas — drag bounds, snap targets, the
   Transformer's min-size guard — already derives from that one `scale`, so they
   **all track zoom automatically** with no other change. Zoom is expressed
   relative to fit (100% = the whole card fitted), which is what a user expects.

2. **The canvas box scrolls when zoomed.** At zoom 1 the Stage exactly fills the
   measured box (no scroll — unchanged behaviour). Zooming in makes the Stage
   larger than the box, which becomes `overflow-auto` and scrolls. `fitScale` is
   measured from the box's own width (not the Stage), so it stays stable as the
   Stage grows — no feedback loop.

3. **Pure, tested zoom maths.** `clampZoom` and `steppedZoom` (in shared-types)
   bound zoom to `[0.5, 3]` and snap +/- clicks to a clean 0.25 grid regardless
   of the starting value. Unit-tested (clamp, step up/down, off-grid snap,
   never-past-bounds).

4. **Controls.** A small toolbar above the canvas: `−`, a percentage button that
   doubles as "fit to width" (resets to 100%), and `+`, with the ends disabled
   at the bounds.

## Consequences

- Members can zoom in for pixel-precise placement and reset to fit with one
  click; at fit the editor looks and behaves exactly as before.
- No document/schema change — zoom is pure view state, never persisted.
- Because the whole canvas already funnels through one `scale`, snapping,
  transform handles, and drag bounds keep working correctly at any zoom with no
  special-casing.
- Scope is button zoom + scroll. Ctrl/⌘-scroll zoom-to-cursor is a natural future
  enhancement but adds pointer-anchored scroll maths; left out to keep this
  change small and reliable.
- This completes the planned editor upgrade (transform handles → snapping → layer
  order → fonts → background → shapes → stickers → zoom).
