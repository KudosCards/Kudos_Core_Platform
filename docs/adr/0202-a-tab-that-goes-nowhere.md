# 0202 — A tab that goes nowhere

## Status

Accepted — implemented. From an external code review (finding 22 of 37).

## Context

The fulfilment queue renders a tab per status, each with a live count from the
API. The server page validated the `status` query parameter against its own
hand-written list:

```ts
const VALID_STATUSES: FulfillmentStatus[] = [
  "pending",
  "in_progress",
  "printed",
  "posted",
  "delivered",
  "failed",
];
```

Six of seven. `returned_to_sender` was missing, so the parameter failed
validation and fell through to the landing view's default.

An operator sees "returned to sender 7", clicks it, and lands on the Pending
queue with the Pending tab highlighted. No error, no empty state, nothing to
say the click did not do what it looked like. And there is no other route to
those cards from this screen.

Two lists of the same thing, written in two files, and one of them was short.
The API was never the problem: `ListFulfillmentQueryDto` accepts every
`FulfillmentJobStatus`, and the counts endpoint already returned the count that
made the tab look clickable.

## Decision

One list, in `@kudos/shared-types`, derived from the schema rather than typed
out:

```ts
export const FULFILLMENT_STATUSES = fulfillmentJobStatusSchema.options;
```

Both the client's tabs and the server page's validator read it. A tab can no
longer point at a status the page refuses, because there is nothing left to
disagree.

Deriving from the schema rather than writing a third list also means a status
added to the enum gets a tab and passes validation without anyone remembering
to update two files. The enum's order already matches the order the print/post
team works the queue in, so the tabs need no separate ordering.

## The review's suggested fix would have made it worse

The review proposed deriving from the existing `OPEN_FULFILLMENT_STATUSES`
constant. That constant is `pending | in_progress | printed` — the statuses a
card can still be _posted_ from, which is a different question. Deriving the
validator from it would have fixed `returned_to_sender` by breaking `posted`,
`delivered` and `failed`.

This is recorded because it is a good example of the trap: two constants in the
same file, both plausibly named, and the wrong one is a one-word change away. A
mutation applying exactly that suggestion is part of the test set, and it fails
four tests.

## Consequences

- All seven tabs go where they say they go.
- The status list exists once.

Two mutations were run, both caught: restoring the hand-written six, and
applying the review's suggested derivation.
