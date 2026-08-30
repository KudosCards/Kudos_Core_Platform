# 0185 — A correction must not make things worse

## Status

Accepted — implemented. From an external code review (finding 8 of 37), on code
introduced by ADR 0178 and amended shortly after.

## Context

`realignBirthdayOccasion` moves a contact's live birthday onto a corrected date
of birth rather than orphaning it (ADR 0178). It read only the rows it might
move:

```ts
status: { in: [...LIVE_ORDER] }   // approved, pending_approval, scheduled
```

and then moved the winner onto the target date:

```ts
await prisma.occasion.update({
  where: { id: keeper.id },
  data: { occasionDate: target, dispatchDate: computeDispatchDate(target) },
});
```

Only one row may hold a given `(recipientId, type, occasionDate)` — the occasion
idempotency key. The rows that can be sitting on the corrected date are exactly
the ones that query excluded: a card already in production (`queued` and
beyond), a birthday the customer **skipped**, a past date retired as `missed`.

So the move hit the unique key. Reproduced against a real database:

```
Unique constraint failed on the fields: (`recipient_id`,`type`,`occasion_date`)
code: 'P2002'   →   HTTP 500
```

This is not a corner case. A contact who skipped a birthday, or whose past date
was retired as `missed` by the sweep ADR 0178 introduced, is carrying precisely
such a row — and the number of them grows over time.

### The damage was worse than a 500

None of the realign ran in a transaction, and it retires the losing rows
**before** it moves the keeper. The sequence was therefore:

1. the date of birth is corrected and committed;
2. the contact's other birthdays are retired or deleted, and committed;
3. the move throws;
4. the request 500s.

The contact ends with a corrected date of birth, their other birthdays
destroyed, and the keeper still on the old wrong date. Every retry repeats step
2 on whatever is left and fails identically at step 3. A correction that made
things worse and could never succeed.

## Decision

### Read every row, not just the movable ones

Deciding where a row can go requires knowing what already holds the date. The
query now reads all of a contact's birthdays and looks for a blocker: anything
on the target date that is not movable.

### When the date is taken, the live row gives way

It cannot go there, and the blocker must not be disturbed — the money is spent,
or the customer said no. The date is already represented, so the live row is
surplus and is cleared by the same past/future rule the losing rows use.

For a **skipped** blocker this is a deliberate choice, and the interesting one.
The customer said "no card for this date"; correcting the date of birth onto it
does not undo that, and resurrecting the send would override an explicit
decision. So the skip stands and the contact is left showing a skipped birthday
on the correct date — honest, visible on the calendar, and one click from being
unskipped. What must never survive is a live birthday on the old wrong date,
which is the actual harm, and the test asserts that directly.

_The first version of that test asserted the contact should end with one live
birthday on the corrected date. That was wrong — it would have meant silently
un-skipping. The test was corrected, not the code._

### The move is guarded, and the whole realign is atomic

The blocker check covers every row it read, so a P2002 can now only come from a
concurrent claim between that read and the write. That is caught and answered
the same way — the date is taken, the row gives way — and anything that is not a
unique-key collision is rethrown, so a real database failure cannot hide behind
a silently unchanged birthday.

`recipients.service.update` now runs the realign inside `$transaction`, so it
can no longer half-apply. A failure leaves the occasions exactly as they were
rather than destroying rows on the way to throwing.

## Consequences

- Correcting a date of birth cannot 500 on this key, and cannot leave a contact
  in a worse state than before the correction.
- `RealignResult` gains `blocked`, recorded on the audit entry alongside
  `moved` / `retired` / `discarded` / `created`, so the trail says why a
  correction did not move anything.
- Three mutations, each caught: removing the blocker check (4 tests), narrowing
  the read back to live rows only (4 tests), and rethrowing instead of handling
  P2002 (1 unit test).
- The race fallback is covered by a unit test with a stubbed client, because no
  end-to-end test can reliably interleave two writes. The `$transaction` wrap is
  belt-and-braces and is **not** covered by a test — with the blocker check in
  place there is no longer a deterministic way to fail mid-realign.
