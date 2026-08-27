# 0169 — The wallet is spent before the card

## Status

Accepted — implemented.

## Context

ADR 0168 gave ops a way to credit a customer's wallet, as a goodwill gesture in
place of a discount code. It did not behave like a discount.

The wallet was **all or nothing**: `debitAndSettleOrder` refused unless the
balance covered the entire order.

```ts
if (balance < order.totalMinor) {
  throw new ForbiddenException("Insufficient wallet balance");
}
```

So £10 credited against a £240 order did nothing at all. The "Pay from wallet"
button did not even appear, and the £10 sat there until the customer topped up
the other £230. It behaved like a gift-card balance — spendable only in whole
orders — rather than like account credit.

That is wrong for the goodwill case, and wrong generally: anyone with a leftover
balance from a refund or a rounded top-up could not spend it without putting more
money in first.

## Decision

**The wallet is always spent first, automatically.** A customer with a balance
never has to choose to use it, and never has to cover a whole order to use any
of it.

- Balance covers the order → paid entirely from the wallet, no Stripe session.
  `checkout()` returns the success page URL, which every caller already
  redirects to, so no client needed changing.
- Balance is short → the whole balance is drawn and Stripe charges the
  remainder.
- The remainder would fall under Stripe's £0.30 GBP minimum → the draw is
  trimmed so the card is charged exactly £0.30, rather than failing a checkout
  over a few pence.
- Guest checkout mints a fresh account, so its balance is always zero and none of
  this applies.
- Auto-send is unchanged: it has no card to fall back on, so it still requires
  the balance to cover the order outright.

### The wallet is reserved at checkout, not debited at settlement

This is the decision the rest of the design follows from, and the alternative is
simply incorrect.

If the Stripe charge were sized at checkout and the wallet debited when the
payment settled, two concurrent checkouts would each size their charge against
the _same_ balance and the second debit would overdraw it. The balance could also
move between the two moments, leaving an order genuinely underpaid.

So the draw is debited **inside the same Serializable transaction that claims the
order**, and recorded on `BatchOrder.walletAppliedMinor`. A balance can back
exactly one order at a time.

This is verified rather than asserted: dropping the Serializable isolation makes
a concurrency test spend the same £1 twice, reproducibly.

### Every abandon path returns the reservation

Because the money leaves before the payment completes, each way a payment can
fail to complete has to give it back. There are five, and missing any one of them
quietly costs a customer their balance:

| Path                                            | Release                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Stripe session creation throws                  | Compensating release, then the order returns to `draft`                                                    |
| `checkout.session.expired` webhook              | Release, then back to `draft`                                                                              |
| `checkout.session.async_payment_failed` webhook | Release, then back to `draft` — a bank debit that never clears                                             |
| Buyer cancels an unpaid order                   | Release before the order is released                                                                       |
| Buyer resumes an abandoned checkout             | **Not** released — the existing reservation is re-used, or the wallet would be debited twice for one order |

(`payment_intent.payment_failed` is deliberately absent: Stripe's hosted page
lets the buyer retry on the same live session, so the order stays
`pending_payment` and keeps its reservation. It is released when that session
eventually expires.)

`releaseWalletReservation` is idempotent by compare-and-swap on
`walletAppliedMinor`, so only the request that actually claims the reservation
writes the credit. It also refuses outright to release an order that is not
`draft` or `pending_payment`. That guard lives in the release rather than in each
caller because it is what makes every call site correct regardless of the order
it does things in: releasing a **paid** order would credit a customer for a card
that is already going to print, and destroy the record of the wallet leg so a
later refund would pay that leg a second time.

A split order's refund returns both halves: Stripe refunds its leg first (it is
the leg that can fail, and it is idempotency-keyed), then the wallet portion is
credited back.

## Alternatives considered

**Let the customer choose whether to spend their balance.** More predictable for
someone deliberately saving a balance, but it leaves the goodwill credit sitting
unused at exactly the moment it was meant to land, and it adds a decision to a
payment screen. Automatic was chosen deliberately.

**A separate order-level discount instead.** Closer to "discount" in the
accounting sense — it would reduce revenue rather than draw down a liability —
but it is a new mechanism alongside the existing plan percentage discount, and it
would not fix the wallet's underlying inability to part-pay.

**Debit at settlement.** Simpler-looking and wrong, for the reasons above.

## Consequences

- **A customer's ledger is noisier.** They see a charge the moment they reach
  Stripe and a refund if they abandon. That is honest, and it is the only safe
  ordering, but it is visible on their wallet page.
- **VAT receipts no longer match order totals.** Stripe invoices only what it
  charged, so a £240 order part-paid with £10 of wallet produces a £230 invoice.
  That is arguably more correct — the £10 was never a sale — but the accounting
  treatment of the wallet portion is a question for the bookkeeper, not the
  software.
- `paymentMethod` remains a two-value enum, so a split order records `card`.
  Every surface therefore reads the split from `walletAppliedMinor` rather than
  inferring it from the method: the customer's order sees "£10.00 from wallet /
  £230.00 on card", and the ops order reads "Wallet + card" with the two amounts
  itemised. The VAT receipt is labelled as covering the card portion only, since
  its total genuinely does not match the order total and a customer has no other
  way to know why.
- This touches live payment for every order. The reservation and release paths
  are the most heavily tested code in the service, and each guard has been
  verified to fail without it.
