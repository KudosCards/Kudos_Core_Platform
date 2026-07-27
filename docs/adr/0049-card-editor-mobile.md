# ADR 0049: Card editor — mobile pass (canvas + QR flow)

Status: Accepted
Date: 2026-07-27

## Context

The card design editor (`/designs/[id]/edit`) was built desktop-first — the code
comment even read "full touch editing is a desktop experience." On a phone the
Konva canvas is authored at a fixed 450×600, wider than the viewport, so it sat
in a horizontally-scrolling box. That made the most common touch task —
**adding and positioning a video QR code** — awkward: the canvas scrolled under
the finger instead of the element moving, the whole card was never visible at
once, and the QR could only be sized/rotated by typing into small numeric fields.

## Decision

A focused mobile pass on the editor, centred on the QR flow.

- **Responsive canvas.** `DesignCanvas` now measures its container (ResizeObserver)
  and scales the Konva `Stage` down to fit (`scaleX/scaleY`, with the Stage's pixel
  width/height scaled to match). The whole card is visible on a phone and elements
  drag in place with no horizontal scroll. Element coordinates are untouched —
  drag events report layer (design-space) coordinates regardless of Stage scale,
  so nothing downstream changes. `touch-action: none` on the canvas lets Konva own
  touch gestures for reliable dragging.
- **Tap-to-deselect on touch.** The full-canvas background `Rect` (which swallowed
  taps meant for the Stage) now deselects on `onMouseDown`/`onTap`, so tapping
  empty space clears the selection on both mouse and touch.
- **Touch-first QR controls.** The QR panel replaces the tiny numeric size field
  with a −/+ stepper (44px targets) and swaps the free-rotation number input for a
  "Rotate 90°" button (which shows the current angle). 90° increments cover a QR's
  needs and are far easier than typing degrees on a phone; exact size entry is
  still possible via the field between the steppers.
- **Bigger tap targets + wrapping.** Toolbar actions, page tabs, and the delete
  button move from `py-1.5` to `py-2`/44px controls; the toolbar and page-tab rows
  wrap instead of overflowing a narrow screen.

## Consequences

- Adding, positioning, and sizing a video QR (and text/image elements) is usable
  on a phone, not just desktop.
- No data-model or API change — purely presentational; the design document format
  is unchanged, so existing saved designs render identically.
- `useLayoutEffect`/`ResizeObserver` run only client-side (the canvas is already
  `dynamic({ ssr: false })`), so there's no SSR concern.
- Verified: web lint/typecheck/build green. As a canvas/touch change, the real
  proof is on a device — best checked via the deploy preview (Netlify's preview
  QR opens it straight on a phone).
