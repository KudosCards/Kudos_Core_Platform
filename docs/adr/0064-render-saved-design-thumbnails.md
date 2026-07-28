# 0064 — Render saved-design gallery tiles from their document

## Status

Accepted

## Context

On the Designs page, the **My designs** tiles showed a blank grey box with only
an "Edit" label — no card artwork — while the **Templates** tiles below showed
full artwork. Members couldn't tell their saved designs apart at a glance.

Root cause (traced, not guessed): the saved-design tile in `designs-client.tsx`
was a static placeholder — a grey box whose only content was the text "Edit". It
never rendered anything visual. Templates render because a `CardDesign` carries
a flat `thumbnailUrl` (an `<Image>` source); a `SavedDesign` has **no
`thumbnailUrl`** — only its editable `document` — and the tile was never wired to
render that document. So there was simply no artwork in the DOM to show. The
artwork itself was present in the data: a template copy inherits the template's
document verbatim (`SavedDesignsService.create` → `template.document`), and an
uploaded-artwork design builds a document with a full-bleed image element — both
contain the artwork as an `image` element with an `assetUrl` on the front page.

## Decision

Render each saved-design tile from its `document` using **`CardFacePreview`** —
the read-only Konva renderer already used by bulk-send and fulfillment to draw a
design's front page (artwork + text). A small `SavedDesignThumb` wrapper measures
the tile width and passes it in, so the 450×600 card scales crisply to fit (the
same responsive-scaling approach the editor canvas uses). The "Edit" affordance
is preserved as a hover overlay over the now-visible artwork.

Considered and rejected for this fix: **generating and storing a flat thumbnail**
for each saved design (like templates have). That needs server-side/headless
rendering or capture-on-save plus a new `thumbnailUrl` column and migration, and
risks the thumbnail drifting from the document on every edit. Rendering the
document directly is proportionate, reuses the existing renderer, and is always
in sync with what the member will actually send. Saved designs are a member's own
small set, so rendering a few client-side canvases in the gallery is acceptable —
the same pattern bulk-send already uses.

## Consequences

- Members see their saved designs' real artwork in the gallery, matching the
  Templates section, and can tell copies apart.
- No backend change, no new data: the fix is purely in how the tile renders
  existing document data. Previews stay in lockstep with edits automatically.
- Consistent with every other design preview in the app (bulk-send, fulfillment,
  print), all of which render the document via `CardFacePreview`.
