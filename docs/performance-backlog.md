# Performance Backlog

Status: **Parked 2026-07-25**, to pick up 2026-07-26. Priority for 25 Jul is fixing
the Brevo email connection; this roadmap is the next block of work after that.

This is a phased plan to cut page load latency across the platform, grounded in the
current codebase. Recommended starting point: **Phase 0 + Phase 1** as one focused PR.

## Findings (what's actually driving latency)

| # | Finding | Where | Impact |
|---|---------|-------|--------|
| 1 | No response compression on the API (`helmet` + CORS set, but no `compression()`). `perPage=100` JSON lists ship uncompressed. | `apps/api` `configure-app.ts` | High, trivial |
| 2 | Auth+API waterfall: the `(app)` layout awaits `account` + `summary`, and only then does the page start its own fetch. Every authed page = two sequential server phases. | `(app)/layout.tsx` | High |
| 3 | Session re-resolved on every call, no dedup — each `serverApiFetch` recreates the Supabase server client + `getSession()`. No React `cache()`. | `api.server.ts` | Medium |
| 4 | No streaming/Suspense — pages block on all data before sending HTML. 18 `loading.tsx` help nav, but each route still waits on its slowest fetch. | all pages | High (perceived) |
| 5 | Over-fetching — 6 pages load `perPage=100`, 4 load `perPage=50` up front. | various | Medium |
| 6 | Images unoptimized — `next/image` used but no `images.remotePatterns` in `next.config`, so remote Supabase/Airtable card art isn't served through the optimizer. | `/cards`, designer | Medium (public) |
| 7 | `cache: "no-store"` on every fetch — correct for per-user data, needlessly dynamic for public catalog data. | `api.ts` | Medium (public) |

Already good (leave alone): router `staleTimes` tuned (30s), Konva dynamically imported,
pgbouncer pooling documented, no heavy date/animation libs.

## Phases

- **Phase 0 — Measurement (½ day).** Timing header/log in `apiFetch` + Server-Timing;
  capture Lighthouse + TTFB for the 6 heaviest pages; confirm prod `DATABASE_URL` has
  `pgbouncer=true&connection_limit=10`. _(DB env confirmed 2026-07-25: `DATABASE_URL` +
  `DIRECT_URL` both set on Railway; schema wires `directUrl`.)_
- **Phase 1 — Cross-cutting quick wins (1 PR, ~1 day).** Add `compression()`; wrap session
  resolution in React `cache()`; trim first-load payloads (`perPage` 100→24/30 above fold).
- **Phase 2 — Kill the waterfall + stream (1–2 PRs).** Render shells immediately, stream
  page content via `<Suspense>` with existing skeletons; move layout `summary` fetch into
  a Suspense boundary so it never blocks the page.
- **Phase 3 — Public pages → CDN/ISR (1 PR).** Make `/cards` and `/cards/[id]` reads
  cacheable (`revalidate`) so they serve from cache/CDN, not a live DB hit per visit.
- **Phase 4 — Images (1 PR).** Add `images.remotePatterns` for Supabase/Airtable hosts,
  correct `sizes`, Supabase image transforms for thumbnails.
- **Phase 5 — API/DB depth (1–2 PRs).** Profile top endpoints from Phase 0, add missing
  composite indexes (extend the admin-overview treatment to recipients/orders lists), fix
  N+1s, add a keep-warm ping for cold starts.
- **Phase 6 — Bundle audit (½ day).** `@next/bundle-analyzer`; confirm heavy client
  components stay code-split; defer non-critical JS.

Expected outcome: Phases 0–2 alone should meaningfully cut TTFB and time-to-first-paint on
every authed page; 3–4 target public/marketing speed; 5–6 are depth.
