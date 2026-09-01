# 0220 — Three defects found reviewing bulk approve

## Status

Accepted — implemented. Found by running the external review's own error classes
over ADR 0219's diff, the same way ADR 0215 did for the weekend's PRs.

## Context

Bulk approve (ADR 0219) shipped with nine e2e cases, six web cases and nine
caught mutations. The audit that follows was not looking for what those tests
already covered; it was looking for the shapes the review found repeatedly:

- a screen stating something untrue (#5, #17, #19, #21, #23)
- two paths that should agree and do not (#3, #31)
- one bad row abandoning the batch (#8, #9)
- unbounded fan-out (#27, #28, #30)
- a tenant-scoped read that is not scoped (the review's one unqualified pass)

The server half came back clean: the read-back is account-scoped, the fan-out is
bounded at `APPROVE_CONCURRENCY`, the request is capped at `BULK_APPROVE_MAX`,
per-row failures are collected rather than thrown, and the transition is the same
atomic `updateMany` the single approve uses.

The **client** half had three.

## Finding 1 — a card that named the wrong day it posts

Approving for auto-send re-times the dispatch date to the chosen postage class,
server-side:

```ts
update.dispatchDate = computeDispatchDate(occasionDate, POSTAGE_LEAD_DAYS[postageClass]);
```

The client pushed the **pre-approval** occasion object into "Approved and
waiting", which still carried the date the queue was holding. That list renders:

```tsx
{
  occasion.dispatchDate && <p>Posts around {formatOccasionDate(occasion.dispatchDate)}</p>;
}
```

So a card approved for first class announced the day it would have gone out on
the old lead. Not a rounding error — the wrong day, stated confidently, about
the one thing this product promises. It is finding 17's shape exactly: a screen
saying something the data does not support.

Fixed by carrying `dispatchDate: null`. The client does not know the new date,
the line is guarded on the field, so it stays away rather than guessing. Saying
nothing is the honest option; the next page load has the real one.

## Finding 2 — the same object named the wrong design

The same stale push left `savedDesignId` null, and the row renders
`designName(occasion.savedDesignId)`, which falls back to `"your chosen
design"`. A card approved with "Well Done" described itself in the abstract.

The client _does_ know this one — it is the design the sender just picked — so
it is now carried through.

## Finding 3 — the two approve paths disagreed about where a card goes

Bulk approve added auto-send cards to "Approved and waiting". The row-level
Approve button did not — it only removed the row from the queue. So a single
auto-send approval left the queue and appeared **nowhere** on the page until a
reload.

That is review finding 23 — advancing a card removing it from views where it
belongs — and it was pre-existing, not introduced by ADR 0219. Bulk approve made
it visible by doing the right thing beside it, which is how a disagreement
between two paths usually surfaces.

Both now call one `scheduleApproved` helper. ADR 0196's lesson, again: the bulk
path and the single path must not each carry their own answer.

## Also fixed — a notice naming somebody who has gone

The failure list persisted after its rows left the queue, so skipping a contact
the bulk approve could not approve left the notice still naming them. Now derived
from the occasions still on screen rather than cleared on each action, so there is
no list to forget to prune.

## Consequences

Four mutations, each caught: keeping the stale dispatch date, forgetting the
design, stopping the single path from scheduling, and keeping failures whose row
has gone.

**One of those tests was vacuous on the first pass and is recorded here because
it nearly counted.** The "says nothing about when it posts" case passed against
the stale-date mutation, because the test fixture never set `dispatchDate` at
all — so the "Posts around" line could not render either way, and the assertion
proved nothing. The fixture now carries a dispatch date, the mutation is caught,
and the test means what it says. A mutation that survives is information; a
mutation that survives because the fixture is empty is a test that would have
sat there for years asserting nothing.

## What the audit did not find

No unbounded fan-out, no unscoped tenant read, no status literal outside
`shared-types`, no local-time arithmetic on a UTC value, no count reported
without checking what happened, and no path where one bad row abandons the
batch — the last of these being the property ADR 0219 was largely built around.
