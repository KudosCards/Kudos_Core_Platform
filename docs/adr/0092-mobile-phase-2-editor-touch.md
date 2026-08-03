# 0092 — Mobile friendliness, phase 2: editor touch ergonomics

## Status

Accepted

## Context

Phase 1 (ADR 0091) handled the highest-traffic member surfaces. Phase 2 turns
to the card editor — the app's most interaction-dense screen — on touch.

Reviewing the editor for phones, the layout was already sound: the canvas scales
to fit the viewport (no horizontal scroll), the side panel wraps full-width below
the canvas via `flex-wrap`, Konva owns touch gestures (`touch-none`) so dragging
is reliable, and every node has an `onTap` handler. The gaps were all about
*target size for a finger*:

- **Transformer handles were 10px.** The resize/rotate anchors on the selected
  element — sized for a mouse — are nearly impossible to grab with a fingertip.
- **Palette, zoom, and panel controls were 32–36px** (shape/sticker glyph
  buttons `size-9`; zoom `size-8`; the B/I/U, alignment, background-type, and
  layer toggle rows `py-1`, ~24px tall). All below the 44px touch guideline.

A parallel look at overlays found no work needed: the shared `Modal` is already a
full-width bottom-sheet on phones (`items-end`, `rounded-t-2xl`, `max-h-[90vh]`
with internal scroll), and the editor/send "overlays" are sticky action bars
(with `env(safe-area-inset-bottom)`) and inline lists, not cramped dialogs.

## Decision

Enlarge touch targets **only on coarse-pointer (touch) devices**, leaving the
mouse experience's compact density untouched.

1. **Transformer anchors** — a `matchMedia("(pointer: coarse)")` watcher (kept
   reactive for 2-in-1 devices that switch input mode) drives `anchorSize`:
   `20` on touch, `10` for a mouse. This is a Konva prop, so it needs JS rather
   than a CSS variant.

2. **All other controls** use Tailwind v4's built-in `pointer-coarse:` variant —
   verified to emit an `@media (pointer: coarse)` block in the build:
   - Shape and sticker palette buttons: `pointer-coarse:size-11` (36 → 44px).
   - Zoom buttons: `pointer-coarse:size-11` / `pointer-coarse:min-h-11`.
   - Style (B/I/U), alignment, background-type, and layer toggle rows:
     `pointer-coarse:py-3.5` (~24 → ~44px tall).

The numeric side-panel inputs remain the accessible alternative for precise
values, unchanged.

## Consequences

- On a phone the editor's handles and controls are finger-sized, so resizing,
  rotating, restacking, and styling an element are all practical by touch — not
  just by the numeric inputs.
- Desktop is pixel-for-pixel unchanged: every enlargement is gated behind
  `pointer: coarse`, which a mouse never matches.
- The approach is uniform and cheap to extend — new editor controls opt into
  touch sizing with a single `pointer-coarse:` utility, and there's one JS
  pointer watcher for the Konva-only case.
- Overlays needed no change; the shared bottom-sheet `Modal` and the
  safe-area-aware sticky bars already cover phones.
- Next (phase 2b / 3): a public/marketing-page polish sweep, then optional
  ops/admin table stacked layouts.
