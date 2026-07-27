# ADR 0045: Performance Phase 4 — image optimization

Status: Accepted
Date: 2026-07-27

## Context

Continuation of the performance roadmap (`docs/performance-backlog.md`), Phase 4.
`next.config.ts` had no `images` config, so every remote card image
(`thumbnailUrl` — catalog artwork in a public Supabase Storage bucket) was
rendered with `next/image`'s `unoptimized` prop. That ships the original
full-size asset to every viewport — a 2:3 card image sized for a 72px basket
thumbnail or a 25vw grid cell — with no resizing, format negotiation (WebP/AVIF),
or responsive `srcset`. The catalog grids and the public `/cards` pages carry the
most image weight on the site.

## Decision

Route the card thumbnails through the Next image optimizer.

- **`images.remotePatterns`** whitelists the Supabase Storage host, derived from
  `NEXT_PUBLIC_SUPABASE_URL` at config time (with a `*.supabase.co` fallback so a
  missing env var can never break the build). Scoped to `/storage/v1/object/public/**`
  — public objects only. The catalog uses `getPublicUrl` (stable, non-expiring
  public URLs — verified), so optimized results cache cleanly.
- **Dropped `unoptimized`** from all five `thumbnailUrl` images (cards gallery,
  card preview, guest send, designs gallery, basket) so they are resized and
  format-negotiated.
- **Added `sizes`** to each (all use `fill`) matching its real layout box, so the
  optimizer generates and serves an appropriately-scaled variant rather than the
  largest one:
  - gallery / designs grid (2 → 3 → 4 cols): `(min-width:1024px) 25vw, (min-width:640px) 33vw, 50vw`
  - card preview (max-w-sm): `(min-width:768px) 384px, 100vw`
  - guest send (max-w-xs): `(min-width:768px) 320px, 100vw`
  - basket thumbnail: `72px`

Local `/marketing/*` images and the logo were already optimized (local `next/image`)
and are unchanged.

## Consequences

- Card images are served resized + in modern formats with a responsive `srcset` —
  materially less image weight on the catalog/marketing pages, especially on
  mobile and in the grids.
- Optimization runs at request time on the hosting platform's image endpoint
  (Netlify's Next runtime honours `remotePatterns`). This is a runtime behaviour
  change that the build cannot fully exercise — **verify the images render on the
  PR's deploy preview** before relying on it in production.
- No API, schema, or data changes; no new dependencies.
- Verified: web lint/typecheck/build green (build validates the `remotePatterns`
  config and all `next/image` usages).

## Follow-up: the placeholder-host crash (caught on the deploy preview)

Removing `unoptimized` also turns on `next/image`'s host validation: at render
time it checks each `src` against `remotePatterns` and **throws if it doesn't
match**, which crashes the whole page. Card artwork isn't always on Supabase —
cards/seeds with no art get a `placehold.co` placeholder (`placeholderThumbnail`
in the catalog sync, and `prisma/seed.ts`). Those hosts aren't (and shouldn't be)
whitelisted, so `/cards` crashed on the deploy preview with "edge function
invocation failed". The pre-merge preview check is exactly what surfaced it;
production was never affected (it still had `unoptimized`).

Fix: `isOptimizableThumbnail(src)` (`lib/card-image.ts`) — optimize a thumbnail
only when it's one of our Supabase public-storage URLs, and render everything
else `unoptimized` (`unoptimized={!isOptimizableThumbnail(src)}` at all five call
sites). This is robust to *any* non-Supabase host — placeholders now, plus any
future/legacy URL — so it can never crash the page again. Real catalog art still
gets optimized (the actual perf win); placeholders just render as-is.
