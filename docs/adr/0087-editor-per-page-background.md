# 0087 — Card editor: per-page background (colour / image)

## Status

Accepted

## Context

Phase 2 continues the editor's creative tools. Every card face was plain white —
there was no way to set a background colour or fill a face with an image. It's
one of the biggest single visual levers a consumer editor (Moonpig) offers, and
it makes the fonts/stickers work look far more finished.

## Decision

Add an optional per-**page** background fill (solid colour or image), drawn
behind that page's elements.

1. **Additive optional schema.** `DesignPage` gains an optional `background`, a
   discriminated union: `{ type: "color", color }` or
   `{ type: "image", assetUrl }`. Omitted ⇒ plain white — so **every existing
   design and template is unchanged**, no migration. It's on the page (not the
   document), so each of the four faces can differ.

2. **Shared Konva `PageBackground` renderer.** Both surfaces
   (`design-canvas` editor and `card-face-preview`) draw it from one component,
   over the white base Rect they already draw — colour ⇒ a filled Rect, image ⇒ a
   `cover`-fitted `KonvaImage`. It's `listening={false}`, so a click on the
   background still lands on the base Rect and deselects. Parity is automatic
   because there's a single renderer.

3. **Pure `coverCrop` helper.** An image background fills the whole 450×600 face
   without distortion (CSS `object-fit: cover`). The centre-crop maths lives in
   shared-types as a pure, unit-tested function (landscape → crop sides, tall →
   crop top/bottom, exact-ratio → whole image, degenerate → zero rect); the
   renderer only feeds it the loaded image's natural size.

4. **Panel control.** A page-level "Background" section (None / Colour / Image)
   sits at the top of the side panel, independent of element selection and
   labelled with the active face. Colour opens a colour input; Image reuses the
   existing signed-upload flow (and records the upload in the "Your uploads"
   library), then stores `{ type: "image", assetUrl }`.

## Consequences

- Each face can have a solid colour or a full-bleed image background, rendered
  identically in the editor and the read-only preview, with a soft-neutral
  default colour so the effect is visible immediately.
- No breaking change: only an additive optional `page.background`; existing
  designs stay white. The image cover-fit is pure and unit-tested rather than
  ad-hoc in the canvas.
- Background images go through the same upload/library path as element images,
  so the orphaned-asset reaper and uploads library already cover them.
- Follow-on Phase 2: stickers/shapes and canvas zoom.
