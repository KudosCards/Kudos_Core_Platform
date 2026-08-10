# 0141 — Order-aware "sent" state (unpaid orders no longer show as "Sent")

## Status

Accepted — implemented. From early customer feedback (Wave 1).

## Context

A customer reported: *"After clicking send, and not paying, the calendar view
shows the card as sent"* and *"my card is 'in fulfilment' but not paid for — is
there a stopper?"*

Investigation established two things:

1. **Fulfilment is correctly payment-gated.** `settleFulfillment` — which creates
   the `FulfillmentJob`s and moves order lines into production — is only ever
   called after a **successful wallet debit** or a **Stripe payment-success
   webhook**. An unpaid card is never actually printed or posted. So this was a
   **display** problem, not a money leak.

2. **The display keyed "sent" off occasion status alone, which is ambiguous.** An
   occasion is moved to `queued` at **checkout** (`BatchOrdersService.create`),
   *before* payment, and stays `queued` all the way through settlement
   (settlement never re-touches occasion status). So `queued` covers both
   "paid, in fulfilment" and "clicked Send but never paid". The calendar treated
   every `queued` occasion as **Sent**.

Worse, this was duplicated in **three** places that had drifted into one wrong
rule: the web calendar day pill (`occasionProgress`), the web event modal
(`SENT_STATUSES`), and the API events `sentCount` (`SENT_STATUSES`). And an
abandoned order is not self-healing on the display side: `checkout.session.
expired` reverts the order to `draft` but deliberately leaves its occasions
`queued` (they're reserved for a resumable draft, and settlement never re-queues
them), so the false "Sent" persisted indefinitely.

## Decision

Make "sent" **order-aware**, from a single shared predicate.

- **`@kudos/shared-types`** gains `isOccasionSent(status, orderStatus)` and an
  order-aware `occasionProgress(status, orderStatus)`. A card counts as sent when
  its occasion is `printed`/`posted`/`delivered` (only reachable after
  settlement), **or** `queued` **and** its order is actually paid
  (`paid`/`fulfilling`/`completed`). A `queued` occasion on a `draft` /
  `pending_payment` / cancelled / absent order is **not** sent. This is now the
  single source of truth; the three drifting copies were deleted and re-point at
  it.
- The API events `sentCount` query now loads each member's linked order status so
  the rollup is order-aware.

Deliberately **not** changed: the occasion stays `queued` on an abandoned/draft
order. That is correct — it's reserved for the resumable order, and settlement
never re-queues it, so reverting it would break the *paid* "sent" display. The
honesty comes entirely from reading the order's payment status at display time,
which is robust across every state (in-flight `pending_payment`, expired-to
-`draft`, or genuinely paid).

A related subtlety was untangled: `events.service` had reused its `SENT_STATUSES`
set for a second, different purpose — blocking deletion of an event whose members
are on an order ("don't destroy order history"). That guard must stay
status-only (an unpaid draft order still references its member occasions), so it
now uses a clearly-named `ORDERED_STATUSES`, separate from the order-aware
`isOccasionSent` used for display.

## Consequences

- The calendar and event views now tell the truth: an occasion only shows as
  **Sent** once its order is paid. Clicking Send and abandoning payment leaves the
  card as upcoming, exactly as the customer expected.
- One shared predicate removes the client/server drift that produced the bug.
- Covered by a unit spec on the predicate (`occasion-sent.spec.ts`) and an
  updated events e2e that asserts `sentCount` is `0` while the order is a draft
  and `2` once it's paid (the old e2e had encoded the bug — asserting `2` for an
  unpaid draft).
- No schema change, no migration.
