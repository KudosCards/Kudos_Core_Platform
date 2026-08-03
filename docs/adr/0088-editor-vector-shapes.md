# 0088 — Card editor: native vector shapes

## Status

Accepted

## Context

Phase 2 continues the editor's creative tools. Beyond text/images/QR there was
no way to add decorative geometry — rules, rectangles, circles, stars, hearts —
the kind of primitives a consumer editor (Moonpig) offers. This is the first
half of "shapes + stickers"; image stickers follow separately.

Vector shapes (drawn natively) were chosen over image assets for the primitives
because they're crisp at any size, recolourable, tiny (no asset pipeline), and
resize cleanly through the existing Transformer.

## Decision

Add a new `shape` element kind rendered with native Konva primitives.

1. **Additive `shape` element kind.** A discriminated-union member on `kind`, so
   existing designs are unaffected. It's positioned by its top-left box
   (x/y/width/height) like an image, with `fill` / `stroke` / `strokeWidth`
   (all optional — a `line` is stroke-only) and `cornerRadius` for a `rect`.
   Supported shapes: `rect`, `ellipse`, `triangle`, `star`, `heart`, `line`.

2. **Shared `ShapePrimitive` renderer.** One component draws a shape in local box
   coordinates `[0..w, 0..h]`, used inside a Group positioned at the element's
   x/y (with rotation) by **both** the editor canvas and the read-only preview —
   so shapes render identically. A transparent hit rect makes the whole box
   selectable/draggable even for hollow shapes.

3. **Group-based node = uniform box model.** In the editor the shape lives in a
   Group that *is* the draggable/transformable node (id + `name="element"`, so
   snapping and the Transformer already pick it up). A resize bakes the Group's
   scale into `width`/`height` (like an image), keeping the shape crisp instead
   of a stretched bitmap. Drag-snapping, layer ordering, duplicate, and the
   nudge/⌘D shortcuts all work unchanged because it's just another element.

4. **Panel + palette.** A "Shapes" row of glyph buttons inserts each shape; the
   selected-shape panel exposes fill (with a "None" option), stroke colour,
   stroke/line width, and corner radius (rect only). The merge-token path is
   untouched — it only transforms `text` elements and passes shapes through.

## Consequences

- Members can drop in recolourable vector shapes that resize crisply and behave
  like every other element (snap, restack, rotate, duplicate).
- No breaking change: the new `kind` is additive; existing designs/templates are
  untouched, and the server merge path already ignores non-text elements.
- Both renderers share one shape component, so there's a single place that
  defines how a shape looks — no parity drift.
- Next: **image stickers** (a curated set of self-hosted SVG graphics placed as
  image elements), then canvas zoom.
