# ADR 0044: Performance Phase 3 — ISR for the public card catalog

Status: Accepted
Date: 2026-07-27

## Context

Continuation of the performance roadmap (`docs/performance-backlog.md`), Phase 3.
The public "browse before you sign up" pages — `/cards`, `/cards/[id]`, and the
guest send entry `/cards/[id]/send` — read the card catalog through
`publicApiFetch`, which used `cache: "no-store"`. So every visit to these
marketing pages was server-rendered on demand and hit the API (and DB) live, even
though the catalog is **identical for every visitor** and only changes on a
catalog sync (nightly, or ops-triggered "Refresh catalog").

## Decision

Serve the public catalog pages from the CDN via Incremental Static Regeneration
(ISR), regenerating hourly.

- **`publicApiFetch` gained an opt-in `revalidate`.** Default stays `no-store`,
  because the same helper also serves genuinely per-request, per-token reads
  (invite previews, guest claim info, RTS cases) that must never cache. Only the
  catalog reads pass `{ revalidate: CATALOG_REVALIDATE_SECONDS }` (3600s) to move
  onto Next's Data Cache.
- **The three `/cards` pages set `export const revalidate = 3600`** so the routes
  are statically rendered and time-revalidated. `/cards/[id]` and `.../send` keep
  `dynamicParams` on (default), so an unknown id renders on-demand once and is
  then cached — no `generateStaticParams`, so the build has no dependency on the
  API being reachable at build time.

## Consequences

- After first render, catalog pages serve from cache/CDN — no live DB hit per
  visit; first-time-visitor / marketing speed improves and origin load drops.
- A catalog change takes up to an hour to appear on the public pages. Acceptable
  for a marketing catalog; **on-demand revalidation** (the catalog-sync job
  calling `revalidateTag`/`revalidatePath` so changes show immediately) is the
  natural follow-up if that lag ever matters.
- The per-token public pages (invite, gift claim, RTS) are unchanged — still
  `no-store`.
- Trade-off: `publicApiFetch` returning `null` on a _transient_ failure during a
  first-ever render of an id can cache a 404 until the next revalidation. Low risk
  (stale-while-revalidate keeps serving the last good page for already-cached
  ids), and no worse for the user than the previous no-store 404.
- Pure web caching change: no API, schema, or dependency changes.
- Verified: web lint/typecheck/build green; build report shows the `/cards`
  routes as static/ISR rather than dynamic.
