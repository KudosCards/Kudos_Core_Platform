# 0083 — Card editor: on-canvas direct manipulation (Konva Transformer)

## Status

Accepted

## Context

The card editor let members add text/image/QR elements and **drag** them, but
every other adjustment — resize, rotate — happened through numeric inputs in the
side panel. Compared to a consumer editor like Moonpig's (our reference for this
work), it felt indirect: you couldn't grab a corner to scale text, there was no
rotate handle, and precise nudging meant typing numbers. This is the first of a
phased set of improvements to bring the editor to that bar.

The renderer is deliberately small — only two surfaces draw a `DesignDocument`:
`design-canvas.tsx` (the interactive editor) and `card-face-preview.tsx` (the
read-only front-page preview). Anything that changes how an element is drawn has
to land in both to stay in parity.

## Decision

Add **direct manipulation** on the canvas via a Konva `Transformer`, plus
keyboard shortcuts, without changing the stored document shape beyond one
additive field.

1. **Transformer handles.** The selected element gets corner scale handles and a
   rotate handle (Moonpig-style), on top of dragging. Text and QR scale
   uniformly (`keepRatio` — font + box together, square QR); an image scales
   freely unless the panel's existing "Lock aspect ratio" toggle is on, which now
   also drives the Transformer (`enabledAnchors` = corners, `keepRatio`). Rotation
   snaps at 0/90/180/270°. A `boundBoxFunc` stops a resize from collapsing an
   element below `MIN_ELEMENT_SIZE`.

2. **Bake scale into real units.** Konva applies a resize as a node `scaleX/Y`.
   On `onTransformEnd` we fold that factor into the element's actual dimensions
   (text → `fontSize` + wrap `width`; image → `width`/`height`; QR → `size`) and
   reset the node scale to 1, so geometry always stays in plain 450×600 design
   units — text stays crisp instead of becoming a stretched bitmap, and the
   document never carries a lingering scale. The fold is a pure, tested helper
   (`bakeScale`) floored at a per-element minimum (`MIN_ELEMENT_SIZE`, or
   `MIN_FONT_SIZE` for text).

3. **Text rotation is additive + optional.** `image`/`qr` already had a
   `rotation`; `text` did not. Added `rotation?: number` to the text element
   (optional, no default) so **existing designs render unchanged** — no
   migration. Both renderers now pass it through. `normaliseRotation` keeps a
   rotate handle's output in `[0, 360)` (and collapses a signed `-0`).

4. **Keyboard shortcuts** on the editor (ignored while typing in a field):
   Delete/Backspace removes the selection, Escape deselects, arrow keys nudge by
   1 design unit (Shift = 10), and ⌘/Ctrl+D duplicates. A "Duplicate" button and
   a shortcut hint were added to the side panel for discoverability, alongside the
   existing numeric inputs — the panel stays as the accessible, precise
   alternative to the handles.

## Consequences

- Resizing/rotating/duplicating now feels direct, matching the reference editor,
  while the numeric panel remains for precision and accessibility.
- The stored `DesignDocument` gains only an optional `text.rotation`; every
  existing saved design and template parses and renders exactly as before.
- Parity is maintained: the read-only preview honours text rotation (and the QR
  placeholder honours its rotation) so a card looks the same in the editor, the
  preview, and — via the same units — at print time.
- The transform math is pure and unit-tested (`bakeScale`, `normaliseRotation`)
  rather than buried in canvas event handlers, and the schema change is covered
  by a test asserting a text element parses both with and without `rotation`.
- Follow-on phases (snapping/alignment guides, layer ordering, richer fonts +
  bold/italic, stickers, per-page background, zoom) build on this selection +
  Transformer foundation.
