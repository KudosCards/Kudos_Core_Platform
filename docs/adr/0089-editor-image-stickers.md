# 0089 — Card editor: image stickers

## Status

Accepted

## Context

ADR 0088 added native vector *shapes*. The second half of the "shapes +
stickers" work is a **sticker library** — pre-made decorative graphics
(balloon, gift, cake, party hat, confetti, flower, crown, rainbow) a member can
drop onto a card. Unlike the geometric shapes, these are richer illustrations.

## Decision

Stickers are curated **self-hosted SVGs placed as ordinary `image` elements** —
no new element kind, no upload pipeline, no third-party requests.

1. **Self-hosted SVG assets.** Eight hand-authored SVGs live in
   `apps/web/public/stickers/`, served same-origin from the app's own domain.
   Same-origin means no CORS taint in the Konva canvas; SVG means crisp at any
   size and tiny. A `STICKERS` catalogue (`lib/stickers.ts`) lists them.

2. **A sticker is an image element.** Clicking a sticker inserts a normal
   `image` element whose `assetUrl` is the sticker's **root-relative path**
   (`/stickers/cake.svg`). It therefore reuses the existing image rendering and
   gets resize/rotate/snap/layer/duplicate for free — no renderer changes.

3. **One small schema loosening.** The image `assetUrl` was a strict
   `z.string().url()`, which rejects a root-relative path. It's now
   `isImageAssetSrc` — an absolute http(s) URL **or** a root-relative path.
   Backward compatible (all existing uploaded absolute URLs still pass), and it
   keeps sticker references domain-independent (they resolve against whatever
   origin is serving the app, so a domain move doesn't 404 old designs). The
   helper is pure and unit-tested.

4. **Panel palette.** A "Stickers" row of thumbnail buttons (rendered from the
   SVGs) sits with the shapes palette; clicking inserts the sticker at a fixed
   square size.

## Consequences

- Members can add polished decorative graphics with one click, and then treat
  them like any image (move, scale, rotate, restack).
- No new element kind and no new renderer path — stickers ride the image element,
  so both the editor and the read-only preview already draw them.
- No breaking change: the `assetUrl` rule only *widened*. Because sticker paths
  aren't in the `design-assets` bucket, the orphaned-asset reaper (which only
  matches `design-assets/<path>`) correctly ignores them — they're static app
  assets, never reaped.
- The set is easily extended by dropping an SVG in `public/stickers/` and adding
  a catalogue entry. Next editor item: canvas zoom.
