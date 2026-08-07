# 0131 — Self-serve cancel-with-refund for a paid, not-yet-posted order

## Status

Accepted (lifts the refund deferral in ADR 0008 for this one case)

## Context

Scheduled sends (ADR 0130) let a customer pay now and have a card posted on a
later date. Managing that order was already partly self-serve — a scheduled
order can be **rescheduled** while none of its cards have printed — but
**cancelling** a *paid* order still routed to support, who issued the refund by
hand in the Stripe Dashboard. ADR 0008 had deferred all automated refunds; ADR
0130 explicitly flagged self-serve cancel/refund as "a deliberate later
decision". This is that decision: the platform's first automated refund.

The safety condition is the same one reschedule already uses: an order can only
be cancelled online while **every card is still `pending`** (nothing in
progress / printed / posted). Once a card has moved past `pending`, real
physical work has begun and cancellation goes back to support. A scheduled
order sits in the ops queue's **upcoming** bucket, days from its post date, so
in practice its jobs are untouched and this window is the common case, not the
exception.

Two money paths exist and both must be refundable:

- **Card** orders carry a `stripePaymentIntentId` and `paymentMethod: "card"`.
- **Wallet** orders spent from the append-only `WalletLedgerEntry` ledger, whose
  balance is the sum of entry amounts (top-ups positive, charges negative).

A module constraint shaped where this lives: `WalletModule` imports
`BatchOrdersModule`, so `BatchOrdersService` cannot import `WalletService`. The
wallet refund credit is therefore written inline in `BatchOrdersService` using
the same ledger primitives, rather than delegating to the wallet service.

## Decision

Add `BatchOrdersService.cancelAndRefund(accountId, actorUserId, id)`, exposed as
`POST /batch-orders/:id/cancel-refund`, and surface a **Cancel & refund** button
in the scheduled band of the order page (shown only while the order is still
reschedulable — i.e. every card `pending`).

Guard once, up front: the order must be `paid` or `fulfilling` and every card
still `pending`; otherwise a 409 points the customer to support. Then, by
payment method:

1. **Card — refund first, then release.** Issue
   `stripe.refunds.create({ payment_intent }, { idempotencyKey: "refund:<id>" })`
   **before** touching the database. The idempotency key is the order id, so a
   retry or a concurrent double-submit collapses onto the *same single refund* —
   Stripe never refunds twice. Only after a confirmed refund does a transaction
   claim the order `cancelled` (status-guarded on `paid`/`fulfilling`) and run
   the shared release. The worst failure is "refunded but not yet released",
   which self-heals on retry — never "released but silently unrefunded".

2. **Wallet — one Serializable transaction.** Claim the order `cancelled`
   (status-guarded), then write a single `refund` ledger entry
   (`amountMinor: +total`, `balanceAfterMinor` from a fresh balance aggregate,
   `reference: "refund:<id>"`) and run the shared release. The status-guarded
   claim **is** the idempotency guard: only the winning transaction writes the
   credit, so concurrent submits can't double-credit the wallet. No external
   call — the funds are already on the platform.

3. **Shared release.** Delete the order's still-`pending` `FulfillmentJob`s
   (nothing will be posted), mark every `OrderRecipient` `cancelled`, and skip
   each settled `Occasion` (`queued` → `skipped`, guarded) so it never
   re-triggers a send. Message pages are left as-is — a card that never ships
   simply has an unreachable QR page, and deleting them adds cascade risk for no
   benefit.

## Consequences

- A customer can cancel a scheduled, not-yet-posted order and get a full refund
  themselves — to their original card (via Stripe) or their wallet (a ledger
  credit) — without a support round-trip.
- **No double refunds by construction:** the card path is protected by a Stripe
  idempotency key, the wallet path by a status-guarded claim. Both are
  retry-safe and self-healing.
- No schema or migration: the refund reuses the existing ledger (`refund` entry
  type already exists) and Stripe's refund API; the release reuses existing
  order/occasion/job states (`OrderRecipientStatus.cancelled`,
  `OccasionStatus.skipped`, `FulfillmentJobStatus` has no `cancelled`, so pending
  jobs are deleted).
- The scope stays narrow and safe: only paid orders where **nothing has been
  prepared** are self-serve-refundable. Anything in progress still routes to
  support, and reschedule-for-recipient-changes still points there too.
- ADR 0008's refund deferral is lifted only for this case. Refunds on orders
  already in production, partial refunds, and refunds outside the scheduled-order
  flow remain out of scope.
