# 0129 — Clip-art library for the card editor (Phase 1: bundled)

## Status

Accepted

## Context

The card editor has a small **Stickers** palette — eight hand-drawn ~0.5 KB
icon SVGs in `public/stickers/`, placed as image elements (ADR for stickers in
the editor). Marketing supplied a first pack of **20 richer birthday
illustrations** ("clipart" internally — a distinct concept from stickers) and
wants them addable in the designer, with more packs to follow.

The raw pack couldn't just be dropped in: it was 6.6 MB (four files 0.5–2.8 MB
of dense vector), carried Creative-Commons / editor (dc/cc/rdf/inkscape)
metadata, and mixed **portrait objects** with **wide "Happy Birthday"
word-art** — so a square insert would squish the banners.

Decision on model (with the user): **dev-maintained, bundled** now; a
managed ops-upload catalog is deferred to a later phase when volume justifies it.

## Decision

Add a **Clipart** library as a distinct, categorised, statically-bundled asset
set with a repeatable build pipeline — separate from Stickers, sharing the
existing image-element placement.

1. **A build pipeline** (`apps/web/scripts/build-clipart.mjs`, `pnpm
clipart:build`). Dev drops raw SVGs into `clipart-src/<category>/` and runs
   it. For each file it: SVGO-optimises (strips **all** metadata/cruft, trims
   precision, keeps viewBox so art stays scalable); renders a tiny WebP
   **thumbnail** for the picker; and picks the placement asset — the cleaned
   **SVG** when light (crisp vector, ideal for A6 print), else a **print-grade
   WebP** (≤1600 px longest side, ~300+ dpi at A6) for the few illustrations
   that stay heavy after cleaning. It regenerates `public/clipart/` and a
   `clipart-manifest.json`. The pipeline cut the pack from **6.6 MB → 1.8 MB**.

2. **A generated catalog** (`src/lib/clipart.ts`) exposing typed `CLIPART` and
   `CLIPART_CATEGORIES` (ordered **Objects** / **Greetings**) from the manifest
   — distinct from `STICKERS`. Each item carries its intrinsic width/height.

3. **A new "Clipart" section** in the editor, grouped by category with WebP
   thumbnails. Clicking one places it via the existing `insertImage(src, w, h)`
   — reusing resize/rotate/snap/layer, centred-and-cascaded placement (ADR
   0126-era editor work) and **true aspect ratio** (so the wide word-art lands
   un-squished). Raw source SVGs are committed under `clipart-src/` for
   reproducibility; `svgo` + `sharp` are dev-only dependencies.

## Consequences

- Members get 20 birthday illustrations in the designer today, and adding the
  next pack is "drop files in a folder, run one command, commit" — no bespoke
  work per pack.
- The picker stays light (thumbnails are a few KB each) regardless of source
  weight; the heavy word-art is raster on the canvas but print-safe at A6.
  Trade-off: those few pieces lose vector crispness if scaled far past their
  intrinsic size — acceptable for decorative headline art.
- Metadata (incl. Creative-Commons tags) is stripped on import as directed;
  this is file hygiene and does **not** by itself grant redistribution rights —
  those are assumed confirmed out of band.
- **Phase 2 (deferred):** a DB-backed clipart catalog + Supabase storage + ops
  upload UI (mirroring the card catalog), for self-serve pack management without
  a deploy. The manifest's shape (key/label/category/src/thumb/size) is designed
  to graduate into it.
