# 0222 — A key date only clears its own occasions

## Status

Accepted — implemented. The review's N1 as filed, plus the structural guard that
would have caught it and ADR 0221 together.

## Context

`upsertKeyDate` and `deleteKeyDate` clear the occasions belonging to a contact's
renewal or anniversary key date — correctly, because the customer has just said
that date is wrong or gone. Both matched on `(recipientId, type, status)`:

```ts
await tx.occasion.deleteMany({
  where: { recipientId, type, status: { in: [...OPEN_OCCASION_STATUSES] }, … },
});
```

A `KeyDateType` is also an `OccasionType`. `CreateEventDto.type` and
`CreateOccasionDto.type` both accept the whole enum, so a shared event or a
hand-added one-off can carry `anniversary` against the same contact — and
without `source` the customer correcting their own renewal date deleted somebody
else's approved card.

**Not reachable through the product today.** Neither `anniversary` nor `renewal`
appears in the shared-event picker (`OCCASION_TYPES`) or the one-off picker
(`EVENT_TYPES`), so nothing but the key-date path creates those types and it
tags them `recurring_per_recipient`. It is reachable through the API, and it
arms the moment either dropdown gains one of those two types — which is an
ordinary product change somebody would make without knowing this was load-
bearing.

Closing it costs a `where` clause. Finding it later costs somebody's approved
card.

`deleteKeyDate`'s occasion delete also named no `accountId`, unlike the
`recipientKeyDate.deleteMany` beside it. `assertRecipient` has already
established the contact belongs to the account, so nothing is reachable through
it — which is the same argument ADR 0215 declined to accept. Consistency is the
whole of that defence and it decays one query at a time.

## Decision

Both deletes name `source: { in: [...ROLLING_OCCASION_SOURCES] }`, and
`deleteKeyDate`'s names `accountId`.

Unlike ADR 0221's, the read here needs no exception: these queries select rows
to delete rather than rows to reason about, so narrowing the query _is_ the fix.

## The guard

This was the second instance of one habit in two days, and the third this week
counting the CSV email pass. The shape:

> the write tags `source`; the read never asks.

`occasion-type-queries-name-the-source.spec.ts` walks every `.ts` file under
`apps/api/src`, extracts the `where` clause of each occasion query, and fails on
any that filters by `type` without naming `source`.

Three things about it are deliberate, and two of them came from mutating the
guard rather than trusting it:

**It reads the `where`, not the whole argument.** `select: { type: true }` asks
for the column rather than filtering on it. The first draft reported
`admin-customer.service.ts` for exactly that, and an exemption list padded with
false positives is how a guard stops being read.

**It matches shorthand.** `where: { recipientId, type, status }` is how both key
date deletes were written. A pattern keyed on `type:` passes them — so the first
draft of this guard **would have missed the very defect it exists to catch.**
That is pinned by its own case now.

**Exemptions can be held to their reasoning.** Two queries legitimately select on
type without source:

- `promoteDueOccasions` promotes a shared event's members of rolling types into
  Approvals along with everything else; a cohort card still has to be approved
  before it can be ordered, and adding `source` would strand them at `scheduled`
  for ever. That is a decision about the events model.
- `realignBirthdayOccasion` must read every birthday row, because the unique key
  is `(recipientId, type, occasionDate)` with no source column and a cohort card
  on the corrected date genuinely occupies it (ADR 0221). Its source check moved
  into a filter over the result rather than disappearing.

The second carries `provesItInstead: "isRolling(o.source)"` — the exemption
claims the check moved, so the guard holds it to that and fails if the call is
deleted. The first draft used the marker `"isRolling"`, which still matched when
the call site was gutted because the helper's _definition_ remained. A proof
marker that matches a declaration proves nothing.

## Consequences

- A key date clears its own occasions and nothing else.
- Four mutations of the code, each caught: reverting either source filter, a
  shorthand-blind rule paired with the defect it must catch, and deleting the
  realign's in-memory check.
- The next occurrence of this shape fails in CI rather than in somebody's
  calendar.

## What was noticed and not changed

`upsertKeyDate`'s `createMany` uses `skipDuplicates: true`, so if another
producer's occasion already holds the new date the key date's own occasion is
not created and nothing says so. Pre-existing, unchanged here, and the honest
outcome is arguable — the date _is_ represented by a card the customer has. It
belongs in a change about what a key date owns, not in a scoping fix.
