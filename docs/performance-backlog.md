# Performance Backlog

Status: **Phase 0 + Phase 1 shipped 2026-07-27** (see ADR 0042). Phases 2–6 remain.

This is a phased plan to cut page load latency across the platform, grounded in the
current codebase.

## Findings (what's actually driving latency)

| #   | Finding                                                                                                                                                                 | Where                         | Impact           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------- |
| 1   | No response compression on the API (`helmet` + CORS set, but no `compression()`). `perPage=100` JSON lists ship uncompressed.                                           | `apps/api` `configure-app.ts` | High, trivial    |
| 2   | Auth+API waterfall: the `(app)` layout awaits `account` + `summary`, and only then does the page start its own fetch. Every authed page = two sequential server phases. | `(app)/layout.tsx`            | High             |
| 3   | Session re-resolved on every call, no dedup — each `serverApiFetch` recreates the Supabase server client + `getSession()`. No React `cache()`.                          | `api.server.ts`               | Medium           |
| 4   | No streaming/Suspense — pages block on all data before sending HTML. 18 `loading.tsx` help nav, but each route still waits on its slowest fetch.                        | all pages                     | High (perceived) |
| 5   | Over-fetching — 6 pages load `perPage=100`, 4 load `perPage=50` up front.                                                                                               | various                       | Medium           |
| 6   | Images unoptimized — `next/image` used but no `images.remotePatterns` in `next.config`, so remote Supabase/Airtable card art isn't served through the optimizer.        | `/cards`, designer            | Medium (public)  |
| 7   | `cache: "no-store"` on every fetch — correct for per-user data, needlessly dynamic for public catalog data.                                                             | `api.ts`                      | Medium (public)  |

Already good (leave alone): router `staleTimes` tuned (30s), Konva dynamically imported,
pgbouncer pooling documented, no heavy date/animation libs.

## Phases

- **Phase 0 — Measurement. ✅ Done (ADR 0042 + 0077).** `Server-Timing` header on every
  API response + opt-in `apiFetch` timing (`API_TIMING=1`). DB env confirmed on Railway.
  A weekly + on-demand Lighthouse workflow (`.github/workflows/lighthouse.yml`, ADR 0077)
  now captures LCP/perf scores on the public pages — non-blocking, reads
  `LIGHTHOUSE_BASE_URL`, no-ops if unset.
- **Phase 1 — Cross-cutting quick wins. ✅ Done (ADR 0042).** Added `compression()`;
  wrapped session resolution in React `cache()`; trimmed recipients first load
  (`perPage` 100→30). Broader payload trimming on the unpaginated lists is folded into
  Phase 5 (needs "load more" UI, not just a smaller number).
- **Phase 2 — Stream page content. ✅ Partially done (ADR 0043).** Page-level `<Suspense>`
  on dashboard + orders: static chrome paints in the first flush, data streams. The riskier
  half — Suspense-slotting the `(app)`/`(ops)` shells to kill the layout auth→page waterfall
  — is **deferred** (touches the auth path + mobile drawer for a modest post-Phase-1 win).
  Applying the split to more pages needs their client components decomposed first; gate that
  on Phase 0 profiling.
- **Phase 3 — Public pages → CDN/ISR. ✅ Done (ADR 0044).** `/cards`, `/cards/[id]`, and
  `/cards/[id]/send` are now ISR (hourly revalidate) — served from cache/CDN, no live DB hit
  per visit. `publicApiFetch` gained an opt-in `revalidate` so the per-token public pages
  (invite/gift/rts) stay `no-store`. On-demand revalidation from the catalog sync is the
  follow-up if the ≤1h lag ever matters.
- **Phase 4 — Images. ✅ Done (ADR 0045 + 0077).** Added `images.remotePatterns` for the
  Supabase Storage host; dropped `unoptimized` and added real `sizes` on all five
  `thumbnailUrl` images so catalog art is resized + format-negotiated. (Thumbnails are
  already Supabase public URLs; Airtable images are copied there by the sync, so no
  Airtable host needed.) Follow-up (0077): `priority` on the two public LCP heroes
  (`/cards/[id]`, `/cards/[id]/send`) + a shared blur placeholder on all five thumbnails.
- **Phase 5 — API/DB depth. ✅ Done (ADR 0046).** Added composite indexes for the hot
  per-account list queries — `batch_orders [account_id, created_at]`, `recipients
[account_id, created_at]`, `occasions [account_id, occasion_date]` — each eliminating a
  sort (proven via EXPLAIN). No N+1s to fix (lists use batched `include`). Keep-warm left
  as an external `/health` pinger (a code cron can't wake a slept Railway service). The
  pre-existing `saved_designs` FK drift flagged here was since reconciled to `SetNull`
  (ADR 0048).
- **Phase 6 — Bundle audit. ✅ Done (ADR 0047).** Audited the Turbopack chunks directly
  (`@next/bundle-analyzer` is webpack-only). Heavy client components already code-split —
  every `react-konva` consumer is behind `next/dynamic({ssr:false})`, so the 304KB Konva
  chunk is lazy-only. Nothing else heavy is eager (rest of first-load is React/Next runtime
  - Supabase auth). Added `pnpm analyze:bundle` as a Turbopack-compatible size report +
    code-split regression guard. No JS to defer.

Expected outcome: Phases 0–2 alone should meaningfully cut TTFB and time-to-first-paint on
every authed page; 3–4 target public/marketing speed; 5–6 are depth.

## Deferred (not started — revisit if the symptom appears)

- **Keep-warm pinger for API cold starts.** After an idle period, the first request to the
  Railway API can be slow — a full container boot if the service sleeps/scales-to-zero, or
  just Prisma/pgBouncer connection re-warmup if it doesn't. Bursty B2B traffic (overnight/
  weekend gaps) means a real user — often the first of the day, or a prospect signing in —
  is the one who eats it. Public `/cards` is CDN/ISR so it's unaffected; the authed app and
  API calls are what a cold start slows.
  - Fix is **infrastructure, not code**: an _external_ uptime pinger (UptimeRobot /
    BetterStack / a Railway or GitHub scheduled job / a Cloudflare worker) hitting the
    existing `/health` URL every few minutes. A code-level `@Cron` can't do it — if the
    service is asleep, its own cron is asleep too. Bonus: the pinger doubles as uptime
    monitoring/alerting.
  - **Only worth it if the symptom is real.** If the Railway service is always-on (paid
    services generally don't scale to zero by default), keep-warm buys little and you'd be
    paying for full-time uptime to avoid it. Decide by checking whether app-sleeping is
    enabled and watching first-request latency after a quiet stretch (the Phase 0
    `Server-Timing` header helps: a cold boot shows a big total time with a normal
    `app;dur`, since the cost is before the handler runs).
