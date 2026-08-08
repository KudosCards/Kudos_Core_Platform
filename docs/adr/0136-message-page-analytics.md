# 0136 — Message-page engagement analytics: read efficiency + event log

## Status

Accepted — all five phases implemented.

## Context

Message-page insights (ADR 0132, Phase 3) expose an engagement funnel
(sent → viewed → clicked → replied) plus per-account rollups. Two follow-up
notes were flagged during that work:

1. **Read efficiency.** `insights()` and `accountInsights()`
   (`message-pages.service.ts`) loaded every page's links *and every reply row*
   via `PAGE_INCLUDE`, then counted in JS. Correct and cheap today, but the
   account rollup grows without bound — it materialises reply bodies just to
   produce ~8 integers.

2. **No time dimension.** Engagement is stored as running counters on
   `MessagePageLink` (`viewCount`, `ctaClickCount`, `firstViewedAt`) and reply
   rows. We know *how many*, never *when* — so "views over the last 30 days",
   trend sparklines, and "someone just viewed your card" are impossible.

Confirmed by tracing the code: the three public write paths all live in
`messages.service.ts` (`viewBySlug`, `trackCtaClick`, `submitReply`), are
`@Public()` and throttled (30/30/5 per minute per IP, ADR 0133), and the
view-count write is already wrapped in swallow-on-error so analytics can never
deny a recipient their message. `admin-customer.service.ts` already uses
`_sum`/`_count` aggregates — the efficient pattern exists in-repo to copy.

## Decision

Counters stay the source of truth for *current state*; an event log is added
purely for *over-time*, and event capture never sits on the critical response
path. Delivered in five independently shippable, individually verified phases
(one PR each, tests + verify gate).

### Phase 1 — Insights read efficiency (no schema/contract change)
Replace the full-include counting in `insights()`/`accountInsights()` with
database aggregates (`aggregate`/`count`/`groupBy`) over the matching links and
replies. Output shape is byte-identical, so `shared-types` and the UI are
untouched; the existing e2e funnel test is the equivalence guard.

### Phase 2 — Event log foundation (capture only, zero user-facing change)
- New `MessagePageEvent`: `id`, `type` (`viewed | cta_clicked | replied`),
  `createdAt`, `messagePageLinkId`, **plus denormalised `accountId` and
  `messagePageId`** so account-level time-series never has to 2-hop join
  through links. Indexes on `(accountId, createdAt)` and
  `(messagePageId, createdAt)`.
- **No PII by design** — no IP, no user-agent, no free text. Just which card,
  what type, when. Keeps the GDPR surface minimal (subjects are recipients who
  never signed up).
- Emitted from the three existing write sites as one extra insert, wrapped in
  the same swallow-on-error guard used for the view counter. Counters keep
  dual-writing.
- Ships **dark** behind `MESSAGE_EVENTS_ENABLED` (a plain-string env flag,
  interpreted `"true"`/`"1"` in the service, matching `STORAGE_REAPER_ENABLED`).
  Kept in env — not `PlatformSetting` — deliberately: the switch must not depend
  on a DB read, since the thing it disables is DB load.

### Phase 3 — Retention (prune-only to start)
Daily `@Cron` (storage-reaper pattern) prunes raw events older than
`MESSAGE_EVENTS_RETENTION_DAYS` (default 90; blank/invalid → 90). Charts only
ever show a bounded window and lifetime counters remain the long-term truth, so
no rollup table yet — add daily rollups later only if a longer window is wanted.

### Phase 4 — Time-series API + contract
`GET /message-pages/:id/insights/timeseries?days=30` and an account variant →
daily buckets `[{ date, views, clicks, replies }]` via `date_trunc` `groupBy`
over events. New additive `shared-types` schema. Reads stay open.

### Phase 5 — Frontend charts
A hand-rolled SVG multi-series line chart (`TrendChart`) — views/clicks/replies
over the window, no chart dependency, matching the custom calendar-grid approach
— with a legend, hover crosshair + per-day tooltip, and a zero-filled empty
state. A shared `TrendSection` adds a 7/30/90-day toggle and drops it into both
the builder insights panel (per page) and the library strip (account-wide).
Series colours are the Okabe-Ito CVD-safe categorical set, validated with the
dataviz palette checker on the app's light surface (the app renders light-only;
the matching dark-surface set is validated and documented in `TrendChart` for
when dark mode is enabled). Identity is never colour-alone — every series is in
the legend and its value shown on hover.

## New configuration

Two new **optional, defaulted, API-only** env vars — nothing existing changes,
nothing is required for boot, no web/Netlify vars:

| Var | Phase | Default | Purpose |
|---|---|---|---|
| `MESSAGE_EVENTS_ENABLED` | 2 | unset = off | Kill switch for event capture. |
| `MESSAGE_EVENTS_RETENTION_DAYS` | 3 | 90 | Raw-event retention window. |

## Consequences / blast radius

- Confined to the message-pages/insights domain + the three public message
  endpoints. **No path touches** auth, Stripe/billing, wallet, sends,
  fulfillment, or CRM.
- The only shared resource reached is the DB connection pooler (Phase 2 adds one
  write per public hit). Mitigated: tiny insert, throttled, swallow-on-error,
  and instantly reversible via `MESSAGE_EVENTS_ENABLED`. Escalation path if
  pooler pressure appears: buffer events in-process and flush periodically.
- Phase 1 carries no user-facing change and is a pure efficiency win.
- Additive migration (new table + enum); no backfill — events accrue from the
  day capture is enabled.

## Alternatives considered

- **Derive counters from events (drop the counters).** Rejected: couples the
  cheap current-state read to aggregation and loses a simple source of truth.
- **Runtime `PlatformSetting` flag instead of env.** Rejected for the kill
  switch (must not depend on the DB it may be protecting); fine for later tuning.
- **Rollup table from day one.** Deferred: prune-only is simpler and sufficient
  until a longer-than-retention window is actually needed.
