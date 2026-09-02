# 0223 — A refund reports what it could not stop

## Status

Accepted — implemented. The follow-up review's N3 and N2, which are the same
defect twice: a refund recording success for something it had not done.

## Context

ADR 0180's rule is that a refunded order with cards in production is never
silent. Both of these broke it in the same direction — not by failing loudly,
but by _recording success_.

### N3 — a switched-off integration confirmed nothing had been left live

```ts
if (!this.client.enabled) {
  this.logger.warn(`…${identifiers.length} imported order(s) were not cancelled…`);
  return { cancelled: [], failed: [] };
}
```

Every identifier reaching that line was imported while the integration was on
and is sitting in Royal Mail's queue. Returning `failed: []` makes that
indistinguishable from "there was nothing to cancel". The caller escalates only
on failures, so nothing was raised — and the audit entry then recorded
`clickAndDropStillLive: []`, asserting nothing was left live at the moment
everything was. The `FulfillmentJob` rows carrying those identifiers are deleted
moments later, so the only remaining trace was a log line.

Reachable by an unset `CLICK_AND_DROP_API_KEY` during a key rotation. It is also
the default in the e2e suite, which is how the first test here reproduces it.

ADR 0179's own rule is that anything not explicitly confirmed cancelled counts as
failed. This branch never reaches `parseCancelResponse`, so it has to apply the
rule itself. It now returns each identifier as `failed`, with the reason.

### N2 — the raced report was built from a snapshot

`releaseRecipientsAndOccasions` read the jobs, deleted the ones not `posted`,
then re-read the survivors. `stopped` used the fresh survivors; membership of
`raced` used the stale statuses:

```ts
raced: jobs.filter((job) => job.status !== "pending");
```

At Read Committed each statement takes a fresh snapshot, so a job that read
`pending` and reached `posted` a round-trip later is skipped by the delete, turns
up in survivors, and is dropped from `raced` because the status it _had_ was
`pending`. End state: customer refunded, card posted and on its way, order
`cancelled`, audit row recording `racedCards: []`.

The exposure is specific to the Stripe-refund path (`cancelAndRefund`, a plain
`$transaction`). The wallet-refund path runs inside `runSerializable`, where a
concurrent commit is either invisible to the snapshot or aborts and retries.

## Decision

Both halves of `raced` now come from what the release itself observed.

Survivors are re-read **with their status** rather than ids alone — a survivor is
by definition `posted`, since the delete spares nothing else.

The delete reports what it deleted:

```sql
DELETE FROM fulfillment_jobs
WHERE order_recipient_id IN (…) AND status <> 'posted'::"FulfillmentJobStatus"
RETURNING id, status
```

**This is the part that was not in the finding, and it is the half that
mattered.** Re-reading survivors closes the case the review described. It does
not close the mirror image: a card that read `pending`, reached `printed`, and
was then deleted. That one is gone by the time anything could look at it, and no
post-delete read can recover it — the status has to come back _with_ the delete
or not at all.

It was found by writing the test for it and watching it still fail against the
fix. Two of the four cases here would have passed a fix that only did what the
finding asked for.

`$queryRaw` is an established pattern here (nine call sites), not an escape
hatch opened for this.

## Consequences

- A refund that could not recall a card says so, in the alert and in the audit
  row.
- `raced` is exact rather than mostly-right: every card that had left `pending`
  when the release reached it, with the status it actually held.
- Three mutations, each caught: the disabled client reporting nothing failed,
  dropping survivors from the report, and reverting deleted rows to the stale
  snapshot.

## What was learned about the guard rail, not the code

The pre-Stripe guard rejects a refund whose cards have already left `pending`
with a 409, so the "already in production" case is **only** reachable through the
race window. The first draft of that test set the status up front, got a 409, and
would have been recorded as covering a path it never entered. It now drives the
status change through Prisma middleware, which is the only way this state occurs
in production too.

## What was not done

The review's #2 also notes the Click & Drop **sweep** still imports on a five
minute timer regardless of `dueDate`, so a card timed six weeks out enters Royal
Mail's queue almost immediately and every refund lands on something already
imported. ADR 0179 defers that deliberately, and it remains deferred: narrowing
the sweep is a change to when cards are imported, not to how a refund reports
itself. Closing it would make this ADR's escalations rare rather than merely
correct.
