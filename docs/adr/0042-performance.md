# ADR 0042: Performance — measurement baseline + cross-cutting quick wins

Status: Accepted
Date: 2026-07-27

## Context

Page loads across the platform were slower than they should be. A read of the
data path (see `docs/performance-backlog.md`) found the structural causes: no
response compression on the API, a per-call Supabase session resolution on the
server, an auth→page fetch waterfall, no streaming, and some oversized
first-load payloads.

This ADR covers **Phase 0 (measurement)** and **Phase 1 (cross-cutting quick
wins)** — the broad, low-risk latency cut that every page benefits from. Later
phases (streaming/Suspense, ISR for public pages, image optimisation, per-
endpoint DB work, bundle audit) remain on the backlog.

## Decision

### Phase 0 — Measurement

- **`Server-Timing` response header** (`ServerTimingInterceptor`, registered
  globally in `configure-app.ts`). Every response carries
  `Server-Timing: app;dur=<ms>` measuring time spent inside the API. It shows up
  in the browser Network tab (Timing → Server Timing) and is exposed cross-origin
  via CORS `exposedHeaders`, so API-side latency is readable straight off
  production traffic with no external tooling.
- **Opt-in upstream-call timing in `apiFetch`** (web). Gated behind `API_TIMING=1`
  in the web server environment — never a `NEXT_PUBLIC` var, so it stays
  `undefined` in the browser bundle and is effectively server-only. When on, it
  logs `[api-timing] <method> <path> <status> <ms> server=<Server-Timing>` per
  call, so a measurement pass can attribute latency to network vs. API handler.
  Off by default; no overhead when unset.

### Phase 1 — Cross-cutting quick wins

- **API response compression** (`compression()` in `configure-app.ts`). gzip on
  every response over the default 1 KB threshold; the list endpoints
  (recipients, orders, occasions) compress ~70–80%. This is the single broadest
  win. It is response-side only, so it never touches `req.rawBody` and Stripe
  webhook signature verification is unaffected (verified: full e2e suite green).
- **Session dedup via `React.cache()`** (`api.server.ts`). A single authenticated
  route makes several `serverApiFetch` calls (the `(app)` layout fetches account +
  summary, then the page fetches its own data). Each previously recreated the
  Supabase server client and re-read the session cookie. The token resolution is
  now wrapped in `cache()`, collapsing them into one client creation + session
  read per request.
- **Trimmed recipients first-load page size** (`PER_PAGE` 100 → 30). The
  recipients table already paginates (prev/next + list filter), so a smaller
  first page lightens the initial SSR payload and DOM with nothing hidden.

## Scope boundaries / non-decisions

- **Other list pages were left at their current page sizes.** Orders, approvals,
  batch-orders, and the admin/ops lists render every row with no pagination UI,
  so trimming their `perPage` would silently hide data rather than page through
  it. Doing it safely means adding "load more" — deferred to Phase 5. Compression
  already captures the byte-size win for those responses.
- **The calendar's `perPage=100` calls are a correctness constraint, not
  over-fetching** — the month grid needs every event in the visible range — so
  they are unchanged.

## Consequences

- Every response is smaller on the wire; every authenticated server render does
  one session resolution instead of N.
- Two always-available measurement signals (`Server-Timing` header, opt-in
  `apiFetch` timing) make the remaining phases measurable rather than guessed.
- New API dependency: `compression` (+ `@types/compression`).
- Verified: API lint/typecheck/unit(73)/e2e(232)/build and web
  lint/typecheck/build all green.
