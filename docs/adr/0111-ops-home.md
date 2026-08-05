# 0111 — Ops home leads with operations

## Status

Accepted

## Context

Final slice of the `/admin` operations rework (after ADRs 0108–0110). The
super-admin dashboard at `/admin` opened with **business** metrics — revenue,
active subscriptions, cards sent, the funnel, at-risk accounts. An operator
starting their day there learned nothing about **what has to ship**: no overdue
count, no "due this week", no signal that a Click & Drop import had failed. The
answer lived in the fulfilment queue (ADR 0108) and calendar (ADR 0110), but the
home page — the first thing ops sees — didn't surface it.

## Decision

Put a **"Must ship"** operations band at the very top of `/admin`, above the
business KPIs, built from data that already exists.

### 1. Reuse `/fulfillment/counts`; add one signal

The dashboard fetches `/fulfillment/counts` (ADR 0108 — status + due buckets)
alongside `/admin/overview`. The only new datum is `clickAndDropErrors`: a count
of **open** cards (pending / in progress / printed) whose last Click & Drop import
push failed — one extra `count` in `counts()`, added to the shared
`FulfillmentCounts`. No new endpoint.

### 2. Five actionable tiles, each a link into the filtered queue

**Overdue** (red) → `?due=overdue` · **Due today** (amber) → `?due=today` ·
**Due this week** → `?due=due_soon` · **Awaiting print** → `?status=pending` ·
**Click & Drop errors** (red) → the queue. The number is coloured by urgency and
greys out at zero, so a clear board reads calm and a red number pulls the eye.
The band also links to the dispatch calendar (ADR 0110).

### 3. Operations above revenue, not instead of it

The business KPIs, revenue chart, funnel and at-risk panel stay exactly as they
were — just below the ops band. The change is about **what an operator sees
first**, not removing the business view.

## Consequences

- Opening `/admin` now answers "what must go out today?" in one glance, and every
  number is one click from the cards behind it.
- No schema change, no new endpoint — one extra count on an existing query and a
  band on an existing page, composing Phases 1 & 3.
- The four-phase `/admin` rework is complete: a dispatch-date queue (0108), order
  detail with real progress (0109), a dispatch calendar (0110), and an
  operations-first home (0111) — all resting on the denormalised `dueDate`.

## Alternatives considered

- **A dedicated `GET /admin/ops-summary` endpoint.** Rejected: `/fulfillment/counts`
  already returns everything but the Click & Drop error count, which is one line
  to add. A second endpoint would duplicate the due-bucket logic.
- **Replace the business dashboard with an ops one.** Rejected: super admins still
  need the revenue/funnel view. Leading with ops and keeping the rest below serves
  both without a mode toggle.
