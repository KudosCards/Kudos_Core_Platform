# 0265 — What the review found

## Status

Accepted

## Context

A review pass over the whole of click and forget — C1 to C8 and D1 to D6, nine
merged pull requests — looking for the kinds of mistake that survive
feature-by-feature work because each one is invisible from inside the phase that
made it.

Six defects in the feature, every one of them shipped. Five are the same shape:
**a promise made in one file and quietly broken in another**.

## Decision

### A date that was never a date

`WalletProjection.firstShortfall.dispatchDate` is declared `z.coerce.date()`,
and the page called `toLocaleDateString()` on it. But `apiFetch` ends with
`response.json() as Promise<T>` — a cast, not a parse — so every date in every
payload is a **string** at runtime, whatever the type says. The page threw, and
only for the subscribers whose balance was short: the ones who most needed to
read it.

The unit test passed a real `Date` and could never have caught it. That is the
lesson worth keeping: a fixture that is more correct than production is a test
of something nobody ships.

Two fixes, deliberately both. The page parses the projection with the schema
that declares it, so the boundary is honest; and the formatter takes
`Date | string`, so no future caller can reintroduce the crash. The test now
feeds the string the API actually sends.

### Every save stripped the message from cards already approved

The occasion's `standingOrderMessageId` is `ON DELETE SET NULL`, chosen in
ADR 0260 so that _deleting_ a message lets an already-approved card fall back to
the design's own words rather than blocking the edit.

The write path deleted the entire message pool on every save and wrote it again.
So the escape hatch became the normal case: editing one message — or changing
the postage and touching no message at all — silently stripped the chosen words
from every card already approved, up to three weeks ahead. On the same page, the
consent statement says:

> You can switch this off at any time, and **changing anything here does not
> affect cards already on their way**.

A message still in the pool now keeps its row. Only one the subscriber actually
removed is deleted, which is the case the SET NULL was chosen for — and both
halves are pinned by tests.

Matching is on text **and** source, and the source is resolved (`?? "written"`)
before the comparison. The first version compared the stored `"written"`
against an omitted, `undefined` source, matched nothing, recreated everything,
and undid the whole fix while looking correct. The e2e caught it.

### A deleted list read as "everybody"

`audienceKind` exists precisely because both audience foreign keys are SET NULL,
so a deleted list leaves a row indistinguishable from a deliberate "send to
everyone" (ADR 0256 records this as the feature's main hazard).

`audienceOf` ignored that column and read the ids. A pool aimed at thirty
children reported `{ kind: "all" }`, the page ticked **Everybody**, and one
press of Save would have made it true — the exact widening the column was added
to prevent, reopened by the read.

Now: the kind decides, `audienceGone` reports the deletion, and the page refuses
to choose on somebody's behalf. Neither radio is pre-selected, a notice says the
list was deleted and that we have _not_ moved it to everybody, and Save refuses
until a person picks.

The same fix closes a second route to the same place: the page was mapping a
smart-list audience to `{ kind: "all" }` on save, silently converting an
instruction we refuse to act on into one that covers everyone.

### A pool whose order was arbitrary

Both pools were read `ORDER BY created_at`, and the designs are written with a
single `createMany` — every row sharing a timestamp to the microsecond. The
order came back arbitrary and could differ between two reads of the same pool.
The design pick is positional, so that is a card chosen by chance rather than by
the rule, and a page that looked unsaved the instant it saved.

The message loop already avoided this, with a comment explaining why — the
knowledge was in the file and the designs beside it did not use it.

Both tables now carry an explicit `position`, written on save and backfilled in
the migration from the existing order, so no live pool is reshuffled by the fix.

### A failed read offered to overwrite the real thing

`GET /standing-order` answers with a real empty instruction (`id: null`) for an
account that has never set one up. So a `null` from the page's loader means the
read **failed** — and the page rendered that as "nothing configured", with a
live Save button sitting over somebody's real instruction, one press from
replacing it with an empty, switched-off one.

The page now tells the difference: a failed read says so and switches saving
off.

## Consequences

- One new migration, additive and backfilled.
- `StandingOrder` gains `audienceGone`; the page reads it before it decides
  anything.
- Six regression tests, each written to fail against the code as it was, and
  each confirmed by putting the old behaviour back.
- One finding is **not** fixed here: `WalletCampaignsService.confirmedEmailFor`
  returns `null` for a Supabase error as well as for an unconfirmed address, so
  an outage is tallied as "nothing owed" rather than "failed" and the sweep's
  warning never fires. It is real, it is in `apps/api/src/wallet`, and no commit
  in this feature touched it — so it belongs to its own change rather than to a
  review of click and forget. Recorded in `docs/backlog.md`.
