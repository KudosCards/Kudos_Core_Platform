# 0229 — A date-of-birth edit is all or nothing

## Status

Accepted — implemented. From the follow-up review's N4 and N5. Completes ADR 0185.

## Context

Correcting a contact's date of birth did three things, in three separate
commits:

```ts
await this.prisma.recipient.updateMany({ where: { id, accountId }, data: dto });
// ...
realigned = await this.prisma.$transaction((tx) => realignBirthdayOccasion(tx, ...));
await promoteDueOccasions(this.prisma, accountId);
await this.audit.record({ ... });
```

**N5 — the audit entry could be lost.** Any failure after the first line left a
changed date of birth with no `AuditLogEntry` naming it. `AuditService`'s own
doc comment says a failed audit write throws precisely "so a silently lost
compliance record can't happen" — and then the record was lost by a failure
_before_ it instead. This is the table that exists to record who touched a
child's personal data.

It also became routine rather than rare. The finding-21 fix made the contact
page send `dateOfBirth` on **every** save, so `dto.dateOfBirth !== undefined` is
true on an address-only edit and the realign path runs every time.

**N4 — the P2002 fallback was dead code.** The realign checks for a blocker,
then moves the keeper onto the corrected date. Something can claim that date in
between, and the unique key refuses the write. That was caught:

```ts
} catch (error) {
  if (!isUniqueViolation(error)) throw error;
  const { retired: r2, discarded: d2 } = await discardLosers(prisma, [keeper], today);
  return { moved: false, ..., blocked: true };
}
```

`prisma` here is the transaction client. **Postgres marks a transaction block
aborted the moment a statement in it fails**, and every later command returns
`25P02 current transaction is aborted, commands ignored until end of transaction
block`. So `discardLosers` failed, the failure propagated, and the customer got
a 500 — the same 500 the catch was written to prevent, arriving by a longer
route. Reproduced before fixing; the test log carries the `25P02`.

## Decision

**One transaction: the contact write, the realign, and the audit entry.**
`promoteDueOccasions` stays outside and after the commit — it is a separate rule
about which occasions are due, and it must not be able to roll back the
correction.

**The P2002 is not caught.** It cannot be recovered from where it is raised, and
the caller retries the whole transaction:

```ts
try {
  ({ recipient } = await attempt());
} catch (error) {
  if (!isOccasionUniqueViolation(error)) throw error;
  ({ recipient } = await attempt());
}
```

The second attempt reads fresh, sees the row that claimed the date, and the
blocker branch — which has been there since ADR 0185 — gives the right answer
with no race at all. The recovery the catch was reaching for already existed one
branch up; it just needed a fresh read to get there.

**One retry, not a loop.** The second attempt only loses if a _third_ writer
takes the date in the same instant. Correcting a date of birth is not a
contended operation, so a conflict that survives a fresh read is a bug to
surface rather than a queue to wait in.

## Consequences

- A failed correction changes nothing: not the date, not the birthday rows, not
  the audit trail.
- A raced correction succeeds on the retry instead of returning a 500.
- Five e2e tests, and four mutations caught: no retry, retrying forever, the
  contact write outside the transaction, and the realign outside it.

### Two mutations that survived, and why

Moving the audit write off the transaction client, and moving the realign off
it, both survive **while still being called inside the callback** — because a
throw from either aborts the enclosing transaction regardless of which client
issued it. The difference is real but only observable if the `COMMIT` itself
fails, which no test can inject through Prisma middleware. Recorded rather than
papered over: passing `tx` is correct (it is what `AuditService` documents, and
it makes the audit atomic with the change rather than adjacent to it), and the
tests do not prove it.

The realign one **did** matter for a different reason, and that gap was real:
folding the realign into the outer transaction removed its own `$transaction`
wrapper, which was the only structural guard on ADR 0185's invariant — the
realign retires and deletes the losing rows _before_ it moves the keeper, so a
failure at the move must take the destruction with it. Nothing asserted that.
The "gives up rather than spinning" test now sets up a contact with a surplus
birthday and checks both rows survive a failed correction, which catches it.

## A test that could not have failed

The unit spec for the P2002 path — _"gives the row up instead of throwing when
the date is claimed mid-write"_ — passed for four months against behaviour that
never once ran in production. Its stub is a plain client object with no
transaction, so the catch worked there. In production the realign is always
inside one, and the catch could not work at all.

The stub differed from the real client in exactly the dimension the code under
test depended on. That is the third such test found in this round of work, after
the two in ADR 0227, and the same shape as the drifted stub in ADR 0221: **a
test double that has diverged from what it stands in for does not fail — it
quietly stops testing, and reports a green tick for a defect.**

The replacement asserts the new contract: the collision is propagated, and
`isOccasionUniqueViolation` recognises it for the caller that retries.
