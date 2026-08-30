# 0203 — Leaving a status is not leaving the view

## Status

Accepted — implemented. From an external code review (finding 23 of 37).

## Context

`advance()` moved a card to its next status and then removed its row:

```ts
// The job leaves the current status filter's view.
removeJob(job.id);
```

True when a status tab is pinned. False in the two views this same file builds
_without_ one: the dispatch-calendar drill-in (`dueOn`) and the deadline view
(`due`), both of which list every still-open card — `pending`, `in_progress`,
`printed` — precisely so the queue agrees with the send-by-5 banner and the
calendar beside it (ADR 0108 §5).

So an operator drills into Friday to work twelve cards, marks each printed, and
each one vanishes. After twelve clicks the screen reads "Nothing in this
queue" — though all twelve are still printed-but-unposted and still due Friday.
They have lost the working list of exactly the cards they now need to post, and
the only way back is to guess at a different filter.

## Decision

The question is not "has this card changed status" but "does it still belong in
what is on screen", and those differ:

```ts
function stillInView(to: FulfillmentStatus): boolean {
  return status ? to === status : OPEN_STATUS_TABS.includes(to);
}
```

With a tab pinned the view is that one status, so any transition leaves it —
including one to another _open_ status, which is the case worth stating: a card
marked printed from the Pending tab is still open and still does not belong on
the Pending tab. Without a tab, the view is every open card, so `pending →
printed` stays and only the move out of the open statuses removes it.

A card that stays is replaced with the row the transition endpoint returns
rather than patched locally, so its status trail shows the server's real
timestamps.

## The review's second location was wrong

The finding also named `bulkAdvance`. It is not reachable from either
status-less view: `bulkStep` is `status ? NEXT_STEP[status] : undefined`, so the
bulk button is not rendered at all unless a tab is pinned — and with a tab
pinned, unconditional removal is correct. `bulkAdvance` is therefore unchanged,
with a comment recording why, rather than carrying a guard for a case that
cannot happen.

This was implemented before it was checked, and then reverted. Worth recording:
an unreachable guard is not free — it is a claim about the code that the next
reader has to verify, and this review has spent thirteen findings on claims that
were not true.

## Consequences

- A drill-in day survives being worked. The list stays, and each card shows what
  has been done to it.
- A pinned tab still empties as cards leave it.

Three mutations were run, each caught: unconditional removal (the original),
never removing, and dropping the pinned-tab half of the condition — the last of
which needed a test written for it, since the existing cases happened to agree
on both branches.

## Noted, not fixed

The queue's row checkboxes carry no accessible name. Out of scope here, and
recorded so it is not lost.
