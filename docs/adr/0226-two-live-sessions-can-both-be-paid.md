# 0226 — Two live Checkout Sessions can both be paid

## Status

Accepted — implemented. Follow-up to ADR 0179; from the follow-up review's
finding 1.

## Context

"Resume checkout" mints a second Stripe Checkout Session for an order the buyer
abandoned. ADR 0179 made the order record which session it is now waiting on, so
that when the abandoned one hits Stripe's own 24-hour expiry, the resulting
`checkout.session.expired` event releases nothing:

```ts
OR: [{ stripeCheckoutSessionId: null }, { stripeCheckoutSessionId: session.id }];
```

That closed the expiry side. **Nothing closed the payment side.** The superseded
session is never told to stop — there is no `sessions.expire` call anywhere in
the codebase — so for up to 24 hours the buyer has two live, payable Stripe
Checkout pages for one order. The abandoned tab is still open; that is why they
came back to resume in the first place. Link or a saved card makes paying it
again one click.

What happens then depends on nothing the buyer can see:

| Order of payment                | Result before this change      |
| ------------------------------- | ------------------------------ |
| new session, then abandoned one | second charge recorded nowhere |
| abandoned session, then new one | second charge recorded nowhere |

Both land in the `count === 0` branch of the completed handler, and the guard
there was:

```ts
const current = await tx.batchOrder.findUnique({ where: { id: batchOrderId } });
if (current && current.status !== "paid") {
  await this.audit.record({ action: "payment_succeeded_after_cancel_anomaly", ... });
}
```

The order _is_ `paid` — it was paid a moment ago by the other session — so the
condition is false and the handler returns having done nothing at all. No audit
row, no notification, no log line. The customer is charged twice, the cards are
printed once, and the only record that the second payment exists is in Stripe.
Nobody looks at Stripe until somebody complains.

The guard was written for the case it names: a payment landing on an order that
had been cancelled in another tab. Against that case it is correct. A second
payment on an order that is _legitimately_ paid was not a state that existed
when it was written, because before resume there was only ever one session.

## Decision

Three changes, because prevention, detection and response are three different
things and this needed all three.

**Stop the superseded session.** On resume, `stripe.checkout.sessions.expire` is
called on the session being replaced.

**Ordering is the whole trick, and the obvious placement is wrong.** The natural
place is the top of the resume branch, before minting the replacement. Do that
and Stripe answers the expire call with a `checkout.session.expired` webhook
while the row still names the old session — `releasableBySession` matches, the
order goes back to `draft`, and its wallet reservation is handed back, all while
we are mid-way through creating a live session to hand the buyer. They pay it,
the completed handler finds a `draft` order and refuses to fulfil, and they have
paid for cards nobody will print. That is precisely the failure ADR 0179 exists
to prevent, re-created by the fix for its sibling.

So the expire runs **after** the row records the new session id. The old
session's expiry event then finds a mismatch and correctly does nothing. It is
best-effort: Stripe refuses to expire a session that has already completed or
timed out, which is the ordinary case for an order resumed the next day, and a
resume must not fail because the session it replaced was already dead.

**Record which session actually paid.** The fulfilling update now writes
`stripeCheckoutSessionId: session.id` alongside `status: "paid"`. The column
means "the session this order is waiting on" up to payment and "the session that
paid it" afterwards. Without that, the mirror-image case is invisible: pay on
the abandoned session, and the row still names the live one, so the live one's
own completion compares equal and reads as a plain redelivery.

A redelivery is then exactly what it should be — the same session arriving
twice:

```ts
if (current.status === "paid" && current.stripeCheckoutSessionId === session.id) {
  return { fulfilled: false, unfulfilled: null };
}
```

Anything else is money Stripe holds that this system did not fulfil against, and
is audited as `duplicate_payment_anomaly` (already paid) or the existing
`payment_succeeded_after_cancel_anomaly` (order moved on), with the paying
session and the payment intent in the metadata.

**Page a person.** The review's note on the old guard was that it "needs to page
someone", and it is right: an audit row nobody reads does not get the customer
their money back. Both anomalies now also raise a `payment_needs_refund`
notification to super admins — the same treatment as the refund-race alert (ADR
0223), for the same reason: this is money, and it needs somebody who can act on
it rather than everybody who can see the bell. Keyed on the offending session id,
so a redelivered webhook rings once.

Refunding automatically from a webhook was considered and rejected. That is money
moving with no human behind it, on a signal that by definition means the system's
model of the order was wrong.

## Consequences

- One payable session per order, so the double charge mostly stops happening.
- When it happens anyway — the buyer completes the old session in the seconds
  between the expire call and Stripe acting on it — it is audited and an operator
  is paged with the payment intent to refund.
- The cards are still printed exactly once. Neither anomaly path fulfils.
- Six mutations, each caught: dropping the expire, moving it to the review's
  suggested placement, not recording the paying session, restoring the old
  `status !== "paid"` guard, and dropping the notification.

## Where the review had it

Filed as finding 1, correctly, including the observation that
`payment_succeeded_after_cancel_anomaly` needs to page someone. The suggested
remedy — `sessions.expire(previousSessionId)` at the top of the resume branch —
is the placement that re-opens ADR 0179's defect, and the finding stopped at
prevention: expiring the old session narrows the window but does not close it,
and says nothing about the payment that still gets through. Detection had to move
too.
