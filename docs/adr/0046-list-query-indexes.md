# ADR 0046: Performance Phase 5 — composite indexes for the hot list queries

Status: Accepted
Date: 2026-07-27

## Context

Continuation of the performance roadmap (`docs/performance-backlog.md`), Phase 5
(API/DB depth). The admin dashboard already got composite indexes (ADR 0014-era
work); the customer-facing per-account list endpoints had not. Each fetches
`where account_id [+ filter] order by <date>` and paginates, but the existing
indexes only covered the *filter*, not the *sort*:

| Endpoint | Query | Existing index | Gap |
| --- | --- | --- | --- |
| Orders (`/batch-orders`) | `where account_id order by created_at desc` | `[account_id, status]` | no `[account_id, created_at]` → sort |
| Recipients (`/recipients`) | `where account_id order by created_at desc` | `[account_id, status]` | no `[account_id, created_at]` → sort |
| Calendar (`/occasions`) | `where account_id and occasion_date between … order by occasion_date` | `[account_id, status]`, `[dispatch_date]` | no `[account_id, occasion_date]` → sort |

So Postgres filtered by account then sorted the whole matching set on every page
load — fine on small tenants, a growing cost as an account accumulates orders /
recipients / events.

## Decision

Add three composite indexes (migration `20260727160858_perf_list_indexes`):

- `batch_orders (account_id, created_at)`
- `recipients (account_id, created_at)`
- `occasions (account_id, occasion_date)`

Each matches its query's `where` + `order by` exactly, so the page is an index
scan in sorted order with no separate sort step.

### Verified with the query planner

Against Postgres 16, `EXPLAIN` of each query (with `enable_seqscan=off` to force
index consideration on the empty test tables) shows the new index used and **no
`Sort` node**:

- Orders → `Index Scan Backward using batch_orders_account_id_created_at_idx`
- Recipients → `Index Scan Backward using recipients_account_id_created_at_idx`
- Calendar → `Index Scan using occasions_account_id_occasion_date_idx`
  (`Index Cond` on `account_id` + the `occasion_date` range)

Full API suite (73 unit + 232 e2e) green against the migrated schema.

## Non-decisions / notes

- **Approvals (`where account_id and status order by occasion_date`)** was left
  on `[account_id, status]`. The pending queue is small, so its sort is cheap; a
  three-column `[account_id, status, occasion_date]` index wasn't worth the write
  cost. Revisit if profiling (Phase 0's `Server-Timing`) says otherwise.
- **Cold starts / keep-warm was *not* done in code.** A self-ping cron inside the
  API can't keep a slept Railway service warm (the cron sleeps with it). If cold
  starts prove painful, the fix is an *external* uptime pinger hitting the
  existing `/health` endpoint — infrastructure, not application code.
- **N+1s:** the list endpoints use Prisma `include`, which issues one batched
  follow-up query (not per-row), so there's no N+1 to fix here (consistent with
  the earlier review pass).

## Out-of-scope drift found (flagged, not fixed here)

Generating the migration surfaced a pre-existing schema/migration drift:
`saved_designs.card_design_id`'s FK is `ON DELETE RESTRICT` in the `init`
migration, but the schema's optional relation implies `ON DELETE SET NULL`.
`prisma migrate dev` tried to bundle that FK change into this migration; it was
deliberately removed so a perf-index migration doesn't silently change delete
semantics. The drift should be reconciled in its own dedicated migration once
the intended behaviour is confirmed.
