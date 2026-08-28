# 0108 — Dispatch-date-driven fulfilment queue

## Status

Accepted

## Context

The ops fulfilment queue (`/fulfillment`, ADR 0010) worked cards in **arrival
order** — `orderBy: createdAt asc`, filtered by a single status. Its own code
carried the tell: a comment reading _"dispatchDate is what actually determines
send urgency"_ sitting directly above an `orderBy` that ignored it. The
occasion's `dispatchDate` — the working-day-accurate date a card must post by,
computed by the engine in ADR 0056 and stored per occasion — **was selected into
the queue payload and then never used**: the web client referenced it zero times.

At small volume that was survivable. At a real week's volume it isn't: an order
of 2,000 cards lands as 2,000 individual rows, interleaved with every other
account's cards, 50 to a page, with nothing telling an operator which of them
must go out in the next few days to hit their recipients' occasions. There was no
way to ask the queue "what's overdue?" or "what's due this week?" — the two
questions that should drive an HQ morning.

This is the first slice of the wider `/admin` operations rework. It makes the
dispatch date the **spine** of the queue.

## Decision

### 1. Denormalise the deadline onto the job as `FulfillmentJob.dueDate`

A nullable `dueDate DATE` column, copied from the occasion's `dispatchDate` at
settlement (`batchOrders.settleFulfillment`), indexed as `@@index([status,
dueDate])` (replacing the bare `@@index([status])`).

- **Why denormalise rather than join.** The queue's whole job is now to filter by
  status and sort/range by deadline over thousands of rows. Denormalised, that's
  a single indexed range scan; joined through `order_recipients → occasions` it's
  a slow join on every read and every count. The occasion's dispatch date only
  changes via the occasion's own edit paths, and a card's deadline is fixed once
  it's paid and queued — so the copy is not a live mirror that can silently drift
  in a way that matters to ops.
- **Null when there's no occasion.** `OrderRecipient.occasionId` is nullable (a
  bespoke card with no dated deadline); those jobs get `dueDate = null` and sort
  last (see below). The migration backfills existing jobs from their occasion and
  leaves occasion-less ones null.

### 2. Compute the urgency cutoffs server-side, filter by date range

"Due within 5 working days" is translated **once per request** into a concrete
calendar date using the same working-day engine (`addWorkingDays`, new in this
slice, the forward counterpart of `computeDispatchDate`). The DB filter is then a
plain `dueDate <=` range against that date — never working-day arithmetic in SQL.
The buckets (mutually exclusive, relative to today):

- **overdue** — `dueDate < today`
- **today** — `dueDate = today`
- **due_soon** — `today < dueDate <= today + 5 working days`
- **upcoming** — `dueDate > that cutoff`
- **no_date** — `dueDate IS NULL`

`DUE_SOON_WORKING_DAYS = 5` is a module constant matching the standard
second-class lead. A future `DispatchConfigService` knob could make it
per-season; it is deliberately not one yet.

### 3. The server owns the working-day calendar, so the server computes urgency

Each queue row carries a server-computed `workingDaysUntilDue` (negative =
overdue, 0 = today, null = undated). The web renders its colour-coded badge
straight from that integer and **never** recomputes UK bank holidays client-side
— there is one source of truth for the calendar, and it's the API.

### 4. Sort by deadline, nulls last, via Postgres' natural ASC ordering

Default `orderBy: [{ dueDate: asc }, { createdAt: asc }]`. Postgres sorts NULLs
last on ASC, so undated cards naturally trail the dated, urgency-ordered ones with
no special-casing; `createdAt` breaks ties. `sort=created_at` preserves the old
arrival order for anyone who wants it. Because the default surfaces overdue cards
at the very top, the landing view can safely be the unfiltered `all` — a filter
can never _hide_ an overdue card.

### 5. Counts return status totals **and** due buckets

`GET /fulfillment/counts` now returns `{ status, due }`. The `due` buckets are
computed in **one** filtered-aggregate round-trip against the same cutoffs the
list uses — so the chip totals and the filtered lists always agree.

They span every **open** status: `pending`, `in_progress` and `printed`.

> **Amended.** They originally counted `pending` alone, reasoning that urgency
> is meaningless for a card already dealt with. That is true of `posted` and
> `delivered`. It is not true of `in_progress` or `printed` — a printed card
> sitting in Click & Drop has not been posted, and its deadline is the entire
> point of it.
>
> Reported from the queue: five cards printed the day before, all due to post
> that day, and "Due today" read **0** — while the send-by-5 banner at the top
> of the same screen said "5 cards to post today" (ADR 0115, open statuses) and
> the dispatch calendar beside it showed 5 (ADR 0110, open statuses). The queue
> was the only one of the three counting `pending`.
>
> A dispatch deadline is a question about work still to go out, so it is scoped
> to the work still to go out. The status tabs stay a filter _within_ that: pick
> one and it narrows the deadline, exactly as a status tab narrows a pinned
> calendar day. Picking a deadline releases the status pin, for the same reason
> the calendar drill-in does — see ADR 0110.

Because the buckets are no longer a partition of `pending`, they no longer sum
to the pending tab; they sum to the open workload. Asking the deadline question
at all is what widens the queue, so the landing view — no `due` parameter — is
still the pending backlog, and no chip is lit on it.

The web shows the chips on the open tabs. On the closed ones (`posted`,
`delivered`, `returned_to_sender`, `failed`) a deadline has nothing left to say,
which is the part of the original reasoning that survives.

## Consequences

- The queue answers "what must post this week" directly: due-bucket filter chips
  (Overdue / Due today / Due soon / Upcoming / No date) with live counts, a
  per-row working-day badge, and deadline-first ordering.
- Every single-row action the web patches in place (claim, transition, dispatch,
  Click & Drop retry) now returns the enriched row shape too, so the client's rows
  stay consistent after an action.
- One additive migration: a nullable column, an index swap, and a backfill. No
  behavioural change to the state machine, the audited export, or dispatch
  automation.
- Later slices (order-level detail, a dispatch calendar, an ops home that leads
  with "must ship today") build on this `dueDate` foundation rather than
  re-deriving urgency.

## Alternatives considered

- **Join through the occasion at query time (no denormalisation).** Rejected:
  turns the queue's core sort/filter and its counts into repeated joins at exactly
  the volume the feature exists to handle.
- **Compute working-day windows in SQL.** Rejected: the holiday/seasonal calendar
  lives in one TypeScript engine; reimplementing it in SQL would be a second,
  divergent source of truth. Translating the window to a concrete date once per
  request keeps the DB doing what it's good at (an indexed range scan).
- **Let the web compute the day badge from `dueDate`.** Rejected: the client would
  need the UK bank-holiday set and the working-day logic, duplicating the engine
  and risking drift. The server returns the number.
