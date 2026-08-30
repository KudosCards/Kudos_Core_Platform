# 0193 — A date set inside the window belongs in the queue now

## Status

Accepted — implemented. From an external code review (finding 25 of 37).

## Context

Adding a contact, correcting a date of birth, and importing contacts all call
`promoteDueOccasions` after creating occasions, so anything already inside the
approval window lands in Approvals in the same moment rather than at 06:00
tomorrow. That was fixed for birthdays in #356, and ADR 0166 records why: a
calendar full of dates beside an Approvals page reading "Nothing waiting for
approval right now", describing the same data at different points in time, with
nothing on screen to say so.

`upsertKeyDate` was left out. Setting a renewal or anniversary created its
occasion as `scheduled` and stopped there.

Monday 09:00, an admin sets a renewal for the following Monday. The occasion's
post-by date — five working days before it — is **today**. Approvals says
nothing is waiting, all day. The nightly sweep promotes it at 06:00 on Tuesday,
one day after the date it needed to be posted by.

The review also noted the `deleteMany` + `createMany` pair ran outside a
transaction, so a failure between them leaves a key date with no occasion at
all: nothing to approve, nothing to send, and nothing on any screen saying
something is missing.

## Two consequences that had to be fixed with it

Making promotion eager breaks two things that were only ever correct because
promotion was slow.

**Re-dating a key date.** `upsertKeyDate` deleted occasions with
`status: "scheduled"` and created the new one. Once promotion is eager, an
occasion inside the window is `pending_approval` within milliseconds, so the
delete no longer matches it: correcting the date would leave the old occasion
sitting in Approvals asking someone to send a card for a date the customer had
just told us was wrong, alongside a second occasion for the right one.

**Deleting a key date.** Same filter, same hole: the key date goes, its promoted
occasion stays in the queue.

Both were reachable before this change — the nightly sweep promotes an occasion
overnight, and an admin who re-dates it the next morning hits exactly this — but
they were rare. Eager promotion makes them the normal case, so shipping the
promotion without them would have traded a slow queue for a wrong one.

## Decision

`upsertKeyDate` runs the key-date upsert, the occasion cleanup, the create and
`promoteDueOccasions` in one transaction. `deleteKeyDate` runs its two deletes
in one.

The cleanup asks two questions instead of one:

- **Which statuses may be removed?** Anything not paid for and not abandoned —
  `scheduled`, `pending_approval`, `approved`. A queued or posted card is a real
  card and its occasion stays put.
- **Which dates?** Only occasions for a date _other_ than the one now being
  written. The occasion for the new date is deliberately left alone rather than
  deleted and recreated: it may already be approved, and recreating it would
  silently discard that decision and ask the customer to approve the same card
  twice. Renaming a key date is not a change of date.

### One name for the status set

`scheduled | pending_approval | approved` already existed as a literal in
`batch-orders.service.ts` under a local name. Rather than write the same three
statuses a second time, it moved to `@kudos/shared-types` as
`OPEN_OCCASION_STATUSES` — the complement of `COMMITTED` and `ABANDONED` — and
both call sites ask it. Three separate literal lists is how the answers drift
apart, which this review has already demonstrated twice.

## Consequences

- A key date set inside the approval window appears in Approvals immediately,
  like a birthday.
- Re-dating one moves its occasion; deleting one takes its occasion with it —
  at any stage short of a paid card.
- An approval survives a label change.
- A failed write leaves the previous occasion intact rather than nothing at all.

Five mutations were run: removing the eager promotion, narrowing each of the two
deletes back to `scheduled`, dropping the same-date refinement so the occasion
is deleted and recreated, and removing the transaction. Each was caught, by the
test written for it.

## A test that had stopped testing anything

`promotes a soon-due key-date occasion into the approvals queue on the scheduler
run` asserted `status === "pending_approval"` after running the scheduler. With
eager promotion it was already `pending_approval` before the scheduler ran, so
the assertion passed without the scheduler doing anything. It now resets the
occasion to `scheduled` first, so it still tests what its name says.

A second test filtered on `status: "scheduled"` while checking that re-dating
re-points the occasion. The status was incidental to the point, and — with
promotion now eager — whether it holds depends on how far today is from
20 September. The filter is gone; the assertion is that exactly one occasion
exists, on the new date.
