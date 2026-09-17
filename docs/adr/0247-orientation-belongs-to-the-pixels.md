# 0247 — Orientation belongs to the pixels, not the metadata

## Status

Accepted

## Context

A phone stores a photo the way the sensor read it and writes a tag saying which
way up it goes. Three things on our path disagree about that tag:

- **Browsers apply it** when they decode — so the editor, `loadNaturalSize`, the
  crop notice and the DPI notice all see the picture upright.
- **`sharp.metadata()` reports it separately and applies neither**: `width` and
  `height` are the stored ones, with `orientation` alongside.
- **pdfkit applies it for JPEG only** — `parseExifOrientation` lives in its JPEG
  class; `PNGImage` never sets the field, so a PNG falls through to "no
  rotation".

`decodeImage` passed PNG and JPEG through untouched and sent every other format
through `sharp(buffer).png()`. That transcode neither rotates the pixels nor
carries the tag into the PNG it writes — and PNG has nowhere to put one. So the
rotation was silently dropped for exactly the formats that go through it.

**WebP is accepted by both upload inputs in the editor.** A portrait phone photo
uploaded as WebP showed upright everywhere a browser drew it and printed on its
side — and, worse, the cover-crop was fitted from the landscape dimensions, so it
was cropped on the wrong axis as well. The recon that found this recorded the
print path as "EXIF-correct"; that was true only of the passthrough branch.

This had to be settled before the artwork gate (P3), not after. A gate measuring
the browser's upright answer would bless artwork that prints sideways, and a gate
measuring `sharp`'s stored answer would refuse a correctly-shaped photo as
47% cropped.

## Decision

**What `decodeImage` returns — bytes _and_ dimensions — describes what the
renderer will actually draw.** One rule, three paths:

1. **Transcode** (PNG, WebP, GIF, …) rotates before encoding: `.rotate()` with no
   argument bakes the tag into the pixels. PNG needs no tag afterwards because
   there is nothing left to correct.
2. **Downscale** rotates too, and takes its resize targets from the _upright_
   dimensions. Without that it would squash a landscape original into a portrait
   box — `fit: "fill"` reports the right box and distorts the picture inside it.
3. **JPEG passthrough** keeps its bytes and its tag, because pdfkit turns a JPEG
   itself and re-encoding would cost detail for nothing — but the dimensions
   returned are the upright ones, so they describe what lands on the card rather
   than how it is stored.

`orientedPixelSize` is the pure rule, in `shared-types`, for every surface that
has to measure rather than draw: tags 5–8 carry a quarter turn and swap the axes;
1–4 are identity, flips and a half turn, and must not.

## Consequences

- A WebP phone photo now prints the way the customer laid it out, and is
  cover-cropped on the axis they expect.
- The gate in P3 can trust one measurement. The catalog sync still measures
  stored dimensions (plan P7) — a smaller problem, because it reports rather than
  refuses, but the same fault.
- Mutation testing drove two of the tests here. Checking the downscale by its
  _dimensions_ could not catch a missing rotation at all, because the resize
  reports a portrait box whether or not the pixels were turned; the test follows
  a marker from the stored top-left to the displayed top-right instead. And
  nothing exercised a tag in the 1–4 range, so a rule that swapped on every tag
  passed — `orientedPixelSize` is now checked across all eight.
- Worth knowing for anyone sampling pixels in a test: `sharp`'s `stats()` reads
  the _input_ image and ignores a chained `extract()`. Two probes here measured
  whole-image averages and read as uniform grey before that was spotted. Crops
  must be materialised with `toBuffer()` first.
