# 0154 — Keyset-paginate the recurring-occasion scheduler

## Status

Accepted — implemented.

## Context

A platform scale review flagged the daily recurring-occasion scheduler
(`OccasionSchedulerService.scheduleBirthdayOccasions`, `@Cron` 6am) as the one
cron whose cost grows with **total platform size** rather than daily work.

The old implementation loaded, in a single `findMany` each:

- **every** active recipient with a date of birth, across every tenant, and
- **every** key date whose recipient is active,

then built one giant `createMany` array from each. That is `O(all contacts)`
memory, materialised daily. Correct and idempotent, but it is the classic
"fine in dev, melts in prod" trap: at hundreds of thousands of contacts the job
holds the whole table in the Node heap at once. Every customer-facing list and
every other cron in the codebase is already bounded (pagination or a date
window) — this was the lone unbounded full-table load.

## Decision

Stream both tables in fixed-size pages instead of loading them whole. The
scheduler now keyset-paginates on the primary key (`id`, `ORDER BY id ASC`,
`cursor` + `skip: 1`), writing each page's occasions with `createMany`
(`skipDuplicates`) before fetching the next. Memory stays flat at one page
(`SCHEDULER_PAGE_SIZE = 1000` rows) regardless of table size.

Keyset (cursor) pagination, not `skip`/`take` offsets: offset pagination
degrades linearly as the offset grows (Postgres still walks the skipped rows),
whereas a PK cursor resumes in O(log n) via the primary-key index. The id
ordering is stable, so a row inserted mid-run below the cursor is simply picked
up by the next day's run — acceptable for an idempotent daily catch-all.

Step 2 of the job — promoting `scheduled` occasions inside the lookahead window
to `pending_approval` — was already a single set-based `updateMany` (no rows
read into the app) and is unchanged.

The public method signature (`scheduleBirthdayOccasions(): Promise<number>`, the
count of promoted occasions) is unchanged, so callers and the existing e2e tests
are unaffected.

## Consequences

- The nightly job's memory footprint is constant, not proportional to the number
  of contacts on the platform — it scales without a rewrite as we grow.
- Slightly more round-trips (one `findMany` + one `createMany` per 1000 rows)
  in exchange for bounded memory. For a daily background job this is the right
  trade.
- No schema change and no migration — pagination is index-backed by the existing
  primary keys.

## Alternatives considered

- **Leave it as-is.** Rejected: the review's remit was scale-readiness, and this
  was the single unbounded load. Cheap to fix now, disruptive to discover in
  production.
- **A raw `INSERT … SELECT … ON CONFLICT DO NOTHING`** to push the whole
  ensure-step into the database with no app-side rows at all. More scalable
  still, but it would duplicate the `nextBirthdayOccurrence` / dispatch-date
  logic (which lives in `@kudos/shared-types` and is shared with manual
  creation) in SQL, risking drift. Paging keeps one source of truth for the
  occasion-building maths. Revisit only if per-page round-trips ever dominate.
- **A larger/looping offset (`skip`/`take`).** Rejected — offset pagination
  slows as it advances; keyset does not.
