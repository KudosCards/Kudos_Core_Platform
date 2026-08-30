# 0179 — A payment is not cancelled by an older session, and a refund is not a card

## Status

Accepted — implemented. From an external code review of the payment and
fulfilment paths.

## Context

Two defects, at opposite ends of the same order lifecycle. Both take the
customer's money and leave them with the wrong outcome, and both do it silently.

### 1. The first session's expiry killed a payment made on the second

An order can outlive several Checkout Sessions. `checkout()` is payable from
`draft` (a first attempt) _and_ from `pending_payment` (a resume — the buyer
closed Stripe without paying and came back), and a resume mints a brand new
session.

Stripe still expires the abandoned one, on its own clock, 24 hours after it was
created. That event carries the same `batchOrderId`, and
`handleCheckoutSessionExpired` acted on it:

```ts
const { count } = await this.prisma.batchOrder.updateMany({
  where: { id: batchOrderId, status: "pending_payment" },
  data: { status: "draft" },
});
```

The status guard reads as a safety net, and it does stop a _redelivered_ event
from disturbing a paid order. It cannot tell one live session from another,
because nothing recorded which session the order was actually waiting on.

So: the buyer starts a checkout at 09:00 Monday. They abandon it. At 20:00 they
come back, hit "Resume checkout", and get a fresh session. They leave the tab
open overnight and pay at 09:30 on Tuesday. Between the two, at 09:00 Tuesday,
Stripe expires Monday morning's session — and the order drops to `draft`, with
its wallet reservation handed back. Half an hour later the payment lands:

```
checkout.session.completed  →  updateMany(status: "pending_payment")  →  count 0
                            →  audit "payment_succeeded_after_cancel_anomaly"
```

The customer has been charged. No `FulfillmentJob` rows exist. Nothing prints,
nothing posts, nothing is emailed, and the only trace is one audit row named
after the _other_ thing it was written for. Reproduced end to end before any fix
was written — the order finishes `draft`, with zero fulfilment jobs, having taken
the money.

`handleAsyncPaymentFailed` had the identical shape and the identical hole.

### 2. A refunded card was still printed and posted

`cancelAndRefund` only permits a refund while **every** card is still `pending`,
on the stated reasoning that `pending` means no physical work has begun.

That reasoning had quietly stopped being true. The Click & Drop sweep runs every
five minutes and selects on import state alone:

```ts
where: { clickAndDropOrderId: null, OR: [...] }   // no status filter
```

So a paid card is pushed into Royal Mail's Click & Drop queue within five minutes
of payment, while it is still `pending`. `pending` is therefore not "untouched" —
it is "already sitting in Royal Mail's queue, waiting for the operator to buy
postage". It is also exactly the window a refund is allowed in.

The release then did this:

```ts
await tx.fulfillmentJob.deleteMany({
  where: { orderRecipientId: { in: orderRecipientIds }, status: "pending" },
});
```

It deleted the row — and with it `clickAndDropOrderId`, the only record that Royal
Mail was holding that card. There was no `cancelOrder` anywhere in
`apps/api/src/shipping/`. The customer got their money back and the card was
printed and posted anyway, with nothing left in the database to reconcile it
against.

## Decision

### An order records the session it is waiting on

`BatchOrder` gains `stripeCheckoutSessionId`, written on every checkout and
overwritten on a resume. The two handlers that _release_ an order share one
where-clause:

```ts
{
  id: batchOrderId,
  status: "pending_payment",
  OR: [{ stripeCheckoutSessionId: null }, { stripeCheckoutSessionId: session.id }],
}
```

The asymmetry is the point, and it is deliberate:

- **A payment fulfils, whichever session it arrived on.** `completed` is
  unchanged and stays unguarded by session. Money is money; if a buyer pays on a
  session we thought superseded, the cards must still be printed.
- **Only the current session may release.** Abandoning a session we have already
  replaced is not evidence of anything.

`null` matches on purpose. Orders already in `pending_payment` when the column
shipped have a live session whose id was never recorded, and orders that never
reached Stripe have none at all. Both fall back to the status guard alone —
precisely today's behaviour — so a checkout in flight across the deploy still
expires and releases normally rather than being stranded in `pending_payment`
forever. Every checkout after the deploy writes the column, so the fleet
self-heals within one session lifetime. **The migration adds a nullable column
and backfills nothing**; there is nothing to backfill it _from_, and guessing
would be worse than the fallback.

### A refund pulls the card back out of Royal Mail's queue

`ClickAndDropClient` gains `cancelOrders(identifiers)` — `DELETE
/api/v1/orders/{ids}` — and `releaseRecipientsAndOccasions` now collects the
identifiers of the imported jobs it is about to delete and hands them back, so
the caller can cancel them upstream.

Four rules govern it:

1. **After the transaction commits, never inside it.** An HTTP call has no place
   in a Postgres transaction, and the money is already refunded by this point.
2. **Never throws.** A Royal Mail outage must not unwind a completed refund.
3. **Silence is not confirmation.** An identifier counts as cancelled only when
   Royal Mail explicitly names it deleted. An unreadable body, an unrecognised
   shape or a silently dropped identifier all report as _still live_. Being
   wrong that way costs an operator a minute; being wrong the other way puts a
   refunded card on a doormat.
4. **What we could not cancel is escalated, not logged.** Failures raise a
   super-admin notification naming each Click & Drop reference and Royal Mail's
   reason, and are recorded on the `cancel_refund` audit entry
   (`clickAndDropCancelled` / `clickAndDropStillLive`). This is a card that will
   be posted unless a human removes it.

Deletes are batched at 50 identifiers, because they travel as a comma-separated
URL path segment and a refunded 500-card order would otherwise build a request
line nothing would carry.

## Consequences

- A resumed checkout is safe. The five behaviours are pinned by tests, including
  the two that guarantee the migration is non-breaking: an order with its own
  live session still releases, and an order with no recorded session still
  releases.
- A refunded card is pulled from Click & Drop, or somebody is told it wasn't.
- `stripeCheckoutSessionId` is `@unique`, matching `stripePaymentIntentId`. A
  session belongs to exactly one order.
- **Not addressed here, and worth its own decision:** the sweep pushing `pending`
  cards to Royal Mail within five minutes is what makes the refund window
  overlap physical work at all. Cancelling upstream closes the hole; it does not
  remove the overlap. Whether the sweep should wait — or whether the refund
  window should narrow — is a product question about how the operator wants to
  batch in the Click & Drop dashboard, not a bug fix.
- The `cancelOrders` wire format carries the same "verify against the live API
  after deploy with the real key" caveat as every other call in that file. The
  fail-safe default (rule 3) is what makes an unverified response shape produce
  an alert rather than a lost card.
