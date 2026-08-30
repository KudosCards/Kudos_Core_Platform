# 0192 — A read-then-write outside a transaction is not a check

## Status

Accepted — implemented. From an external code review (finding 16 of 37).

## Context

Centre accounts pay per seat. `createInvite` refuses a new invite once members
plus pending invites fill the paid seat count (ADR 0035). The check was three
unguarded reads followed, some milliseconds later, by an unguarded upsert:

```ts
const [memberCount, pendingInviteCount] = await Promise.all([...]);
const limit = entitlement.includedSeats + (await this.accountExtraSeats(accountId));
if (memberCount + pendingInviteCount >= limit) throw new ForbiddenException(...);
// ... later ...
await this.prisma.invite.upsert({ ... });
```

Every other paid-resource gate in this codebase — wallet debits, the recipient
cap, auto-send — runs inside `runSerializable`. This one did not.

An admin bulk-inviting four teammates from the UI fires four requests together.
All four read `used = 1` on a 3-seat plan before any of them has written, all
four pass a gate that should have stopped two, and all four insert. The
`@@unique([accountId, email])` constraint does not help: the racing invites are
for four different people.

The consequence is not a cosmetic overshoot. Once those invites are accepted the
account holds seats it never paid for, and `setExtraSeats` refuses to reduce
below the seats in use — so the account is stuck above its paid seat count until
someone intervenes by hand.

### The test had to be made to fail on purpose

Fired as four plain concurrent requests, this reproduced only sometimes: the
first attempt failed with 3 invites on a 2-seat headroom, but the same test
passed inside the full suite. A regression test that catches the bug on some
runs is not a regression test.

The interleaving is therefore pinned rather than hoped for: every request is
held immediately after it counts the seats in use, and released once all four
have counted. That is exactly the state a bulk invite produces, and with it the
pre-fix code failed on every run — all four invites created against two free
seats.

One trap is worth recording, because the first version of the test fell into it.
The hold was originally a spy on `prisma.invite.count`. The fix moves that read
onto a **transaction client**, so post-fix the spy simply stopped firing: the
test passed while proving nothing. It is now hooked through Prisma middleware,
which sees queries issued through a transaction client too, and the test asserts
the gate was actually reached — so a hold wired to the wrong call site fails
loudly instead of passing silently.

## Decision

The member check, the seat count, the extra-seat read and the upsert all run
inside one `runSerializable` transaction — the codebase's existing primitive for
read-then-write races, retrying on P2034 and surfacing an exhausted conflict as
a 503 with `Retry-After` rather than a 500.

Two things stay outside it deliberately:

- **The invite token and expiry**, minted before the transaction. A
  serialization retry re-runs the callback, and a token that changed between
  attempts would mint a fresh secret per losing attempt for no reason.
- **The invite email and the audit entry**, sent after it commits. External
  I/O inside a transaction that may be retried would send an invite for a seat
  the account did not get.

The membership check moved inside as well: an invite being accepted concurrently
is the same race wearing a different hat.

## Consequences

- Four simultaneous invites against two free seats now produce exactly two
  invites. The losers get a `403` (they re-read and see the limit reached) or a
  `503` asking them to retry — both correct, and which one depends on whether
  they read before or after the winner committed.
- The seat gate now behaves like every other paid-resource gate in the codebase,
  which is worth as much as the fix itself: the next person reading this file
  finds the pattern they expect.

## On mutation coverage, honestly

Three mutations were run. Replacing `runSerializable` with a plain
`$transaction` at the default isolation level is caught — all four invites are
created, which is worth knowing: a transaction alone does not fix this, only a
serializable one does. Loosening the comparison from `>=` to `>` is caught.

One is **not** caught: moving the three reads back outside the transaction while
leaving the upsert inside. In this fixture Postgres aborts the racing inserts
anyway, `runSerializable` retries, and the retry re-reads correct counts — so
the outcome is right for an incidental reason. That variant is still wrong, and
the reads still belong inside: with them outside there is no read-write
dependency for SSI to reason about at all, and whether the bare inserts happen
to conflict is an implementation detail of index-level predicate locks, not a
guarantee. Recorded here rather than papered over, because the distinction is
the whole point of the fix.
