# 0180 — The guard that counts runs after the refund, not before it

## Status

Accepted — implemented. From an external code review of the payment and
fulfilment paths (finding 3 of 37).

## Context

`cancelAndRefund` is the customer's own "Cancel & refund" on a paid order. It
is allowed only while **every** card is still `pending`, on the reasoning that
`pending` means no physical work has begun:

```ts
const started = order.orderRecipients.some(
  (r) => r.fulfillmentJob && r.fulfillmentJob.status !== "pending",
);
if (started) throw new ConflictException("Some cards are already being prepared…");

// …then, hundreds of milliseconds later:
await this.stripe.refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey: … });
```

Between those two statements sits a network round-trip to Stripe. The guard is
never asked again. An operator working the queue during that round-trip — a
claim, a print, a bulk-advance across a Friday batch — moves a card out of
`pending`, and nothing notices.

The release that followed only ever dropped the still-`pending` rows:

```ts
await tx.fulfillmentJob.deleteMany({
  where: { orderRecipientId: { in: orderRecipientIds }, status: "pending" },
});
```

So the raced card **survived**. And neither `claim()` nor `applyTransition()` in
`FulfillmentService` looks at the batch order's status at all — they guard on
the job's own status — so that surviving card stayed fully advanceable, right
through to `posted`.

The end state: the order reads `cancelled`, the customer has their money back in
full, the occasion reads `skipped` on their calendar, the order line reads
`cancelled` — and a live card sits in the ops queue that an operator will print
and post. Reproduced by having the Stripe mock advance the card mid-call, which
is precisely the window: the job comes back `printed`, on a refunded order.

The pre-Stripe guard cannot be fixed by moving it. Checking again _just before_
the Stripe call only narrows the window; checking _instead_ after the call is
what closes it.

## Decision

**The release is the guard.** The pre-Stripe check stays exactly where it is —
it is what turns the ordinary "you can't cancel this now" case into a friendly
409 instead of a refund followed by an apology — but it is no longer load-bearing.

Inside the release transaction:

1. **Stop everything short of `posted`.** The order is cancelled and the money
   is back, so nothing may go out. In the normal path every card is `pending`
   and this is identical to the old behaviour; it differs only in the race,
   which is the bug.
2. **Leave `posted` alone.** That card is in Royal Mail's hands. Deleting the
   row would erase its tracking reference and the delivery poll that follows it,
   buying nothing — the card is already gone.
3. **Bound the delete on `status: { not: "posted" }`**, not on the ids just
   read. Under Read Committed a card can reach `posted` between the read and
   the delete; bounding the statement means it survives rather than being
   silently dropped.
4. **Re-read the survivors rather than infer them**, so what gets reported is
   what is actually there.

### Why it reports rather than refuses

By the time the recheck runs, Stripe has already paid the money back. Refusing
the release would leave an order that is `paid` in our database and refunded at
Stripe, and every retry would hit the same guard forever. That is a worse state
than the one being fixed.

So the release completes, and the discrepancy is escalated. `refundRacedFulfillment`
raises a super-admin notification distinguishing the two cases, because they need
different actions:

- **Stopped in time** — pulled from the queue, but somebody printed a card for
  nothing. Stock to write off.
- **Already posted** — beyond recall. _The customer has been refunded and will
  still receive a card._ Support needs to know that before the customer rings,
  not after.

It is not idempotency-keyed on the order: each occurrence is a distinct
incident, and a suppressed duplicate here is a card nobody chased. The same
detail lands on the `cancel_refund` audit entry as `racedCards`.

## Consequences

- A refunded order can no longer leave a live card in the fulfilment queue.
- The Click & Drop cancel from ADR 0179 now covers every card the release stops,
  not only the `pending` ones — a card that was printed and imported still gets
  pulled from Royal Mail's queue. A `posted` card is deliberately excluded: its
  Click & Drop order is spent, and the delete would fail anyway.
- Three mutations pin the `posted` boundary from both sides: reverting the
  delete to `pending`-only fails the stop test; widening it to delete everything
  fails the escalation test; removing the escalation fails it too.
- **Not addressed here.** `FulfillmentService.claim` and `applyTransition` still
  ignore the batch order's status. This fix removes the rows, so there is
  nothing left in the queue to advance and the bug is closed — but the _class_ of
  bug isn't. A card whose order is cancelled ought to be unadvanceable on its own
  account, and any future path that leaves such a row would reopen this. That is
  a change to the ops queue's semantics and belongs in its own decision.
