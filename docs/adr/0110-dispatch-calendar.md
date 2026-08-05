# 0110 — Dispatch (fulfilment) calendar

## Status

Accepted

## Context

Third slice of the `/admin` operations rework (after ADR 0108's dispatch-date
queue and ADR 0109's order detail). The queue answers "what's overdue / due this
week" as a list; ops also needs the **week-at-a-glance**: how much posting work
lands on each day, so HQ can see a heavy Thursday coming and staff for it. The
customer app already has a month/week/list `/calendar`, but it plots per-account
**occasions** — the wrong data and the wrong scope for a fulfilment workload view.

## Decision

A cross-account **dispatch calendar** at `/fulfillment/calendar`, keyed on
`FulfillmentJob.dueDate` (ADR 0108), showing the open posting workload per day.

### 1. It plots open fulfilment jobs, not occasions

The calendar counts jobs in `pending` / `in_progress` / `printed` — cards not yet
posted — bucketed by `dueDate`. Posted/delivered cards are done and excluded:
they're history, not workload. This is a distinct data source from the customer
occasions calendar, so it gets its own endpoint.

### 2. `GET /fulfillment/calendar?from&to` returns counts, computed in the DB

One `groupBy(dueDate, status)` over the open statuses in the window yields
per-day `{ total, pending, inProgress, printed }`; a single `count` of open jobs
with `dueDate < from` gives `overdueBefore`, for a "carried in" banner. The grid
**never** fetches individual cards — it renders counts and links out. The window
is validated (ISO dates, `to >= from`) and capped at 92 days so one request can't
scan an unbounded range.

### 3. Precise drill-in via a `dueOn` queue filter

A day cell links to `/fulfillment?dueOn=YYYY-MM-DD` — a small exact-day filter
added to the queue's `list()` that takes precedence over the `due` bucket. So
clicking a day lands on exactly that day's cards in the existing queue (where the
real print/post work happens), rather than a fuzzy bucket or a duplicated
work surface on the calendar itself.

### 4. Reuse the grid maths, not the component

The customer calendar's pure date-grid helpers (`monthGridRange`, `weekRange`,
`fetchRange`, `ymdUTC`, …) moved to `apps/web/src/lib/calendar-grid.ts`, shared by
both calendars; `(app)/calendar/calendar-utils.ts` re-exports them so the customer
calendar is untouched. The ops grid is a lean custom renderer (month / week /
list) — the 798-line occasion client isn't shared, only the maths. All date
bucketing is UTC, matching how `dueDate` (`@db.Date`) is stored.

### 5. Urgency colouring mirrors the queue

A day holding open cards past its date reads red (overdue backlog), today amber,
future neutral-green — the same visual language as the queue's working-day badges.

## Consequences

- HQ opens month/week/list, sees the posting load per day, and clicks any day to
  work exactly those cards in the queue. The overdue-carry-in banner links to the
  queue's overdue filter.
- Read-only by design: no bulk actions on the calendar. Print-run / bulk-post
  stay in the queue, which the day-click lands in — one place to act, one place to
  survey.
- No schema change; one grouped aggregate + one count per view. Builds entirely on
  ADR 0108's `dueDate`.
- The shared `calendar-grid.ts` removes the duplicated date maths that would
  otherwise drift between the two calendars.

## Alternatives considered

- **Extend the customer occasions calendar to an ops mode.** Rejected: different
  data (jobs vs occasions), different scope (cross-account vs per-account), and it
  would entangle a customer surface with ops concerns.
- **Return cards per day, not counts.** Rejected: a month can hold thousands of
  cards; the grid only needs counts, and the queue (via `dueOn`) already renders
  the cards for a chosen day.
- **Bulk actions on the calendar.** Deferred: it would duplicate the queue's
  print-run/transition surface. The calendar surveys; the queue acts.
