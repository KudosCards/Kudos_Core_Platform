# 0155 — Aggregate the admin overview in the database, not app memory

## Status

Accepted — implemented.

## Context

The platform scale review flagged `AdminService.overview()` (the super-admin
dashboard's single summary endpoint) as loading whole tables into application
memory. It ran three `findMany` calls with no bound:

- **every** account (`id, name, type, planId, createdAt`),
- **every** subscription (`accountId, status`),
- **every** paid order in the last 12 months (`accountId, createdAt, totalMinor`),

then computed the account/plan/subscription counts, monthly-revenue buckets,
funnel, and at-risk list in JavaScript. Cost is `O(all accounts + all subs +
12mo of orders)` in the Node heap, on every dashboard load. Ops-only, so it
never touched a customer's request path — but it degrades as the platform grows
and was the last in-memory aggregation of a whole table.

## Decision

Push the aggregation into Postgres. `overview()` now issues a fan-out of
DB-side aggregates (via `Promise.all`), and **no table is read into app
memory**:

- **Counts** — `account.count()`, `account.groupBy(['type'])`,
  `account.groupBy(['planId'])`, and the existing `batchOrder.aggregate`
  (all-time + last-30-day `_count`/`_sum`) and `orderRecipient.count`.
- **Monthly revenue** — a `$queryRaw` `GROUP BY EXTRACT(YEAR…), EXTRACT(MONTH…)`
  over paid orders in the 12-month window, folded into the 12 month buckets.
- **Funnel** — a `$queryRaw` `count(DISTINCT account_id) FILTER (…)` for
  "placed a paid order" and "had one completed".
- **Active subscriptions** — a `$queryRaw` `count(DISTINCT account_id)` over
  active-status subscriptions.
- **At-risk** — a single `$queryRaw` that returns **only the at-risk accounts**
  (no active subscription, and `COALESCE(MAX(paid order in window), signup) ≤
  now − 30d`), ordered most-idle first. The one query that returns rows returns
  a small set, not the whole account table.

Raw SQL is used only where Prisma's typed API can't express the shape
(date-part grouping, `COUNT(DISTINCT … ) FILTER`, the correlated at-risk
`NOT EXISTS` + `HAVING`). It follows the `status::text IN (…)` +
`Prisma.join(...)` pattern already established by `progressForOrders` in the
same file, with all values parameterised.

### Timezone correctness

`created_at` is `timestamp(3)` **without** time zone and Prisma stores UTC in
it, so `EXTRACT(YEAR/MONTH FROM created_at)` reads the same UTC wall-clock that
the old JS `getUTCFullYear()/getUTCMonth()` bucketing used — no `AT TIME ZONE`
needed, and the month buckets line up exactly.

## Consequences

- The dashboard's memory and transfer cost no longer scale with total accounts /
  subscriptions / orders — the database returns scalars and a small at-risk set.
- The response contract (`AdminOverview`) is byte-for-byte unchanged; the web
  dashboard needs no changes.
- Slightly more queries, but each is an indexed aggregate and they run
  concurrently. The existing admin indexes (`batch_orders [status, created_at]`,
  `subscriptions [status]`, `accounts [created_at]`) already back them.
- A behavioural equivalence note: for an at-risk account whose most recent paid
  order predates the 12-month window, "days idle" is now measured from signup
  (matching the old code's `?? createdAt` fallback, which also ignored
  out-of-window orders) — membership in the at-risk set is unchanged.

## Alternatives considered

- **Keep the in-memory computation.** Rejected — it was the flagged issue and the
  last whole-table load in the codebase.
- **A materialised view / cached snapshot refreshed on a cron.** Overkill for an
  ops dashboard viewed occasionally; adds staleness and moving parts. The
  live DB-side aggregate is fast enough with the existing indexes.
- **Pure Prisma (no raw SQL).** Prisma `groupBy` can't express date-part
  bucketing, `COUNT(DISTINCT) FILTER`, or the correlated at-risk query, so the
  monthly/funnel/at-risk parts would still have needed row scans. Two focused,
  parameterised raw queries are the smaller, clearer cost.
