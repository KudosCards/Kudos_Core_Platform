# 0157 — Order-status honesty, calendar select cue, checkout re-sync (user feedback)

## Status

Accepted — implemented (items 1–4).

## Context

Four pieces of user feedback on the ordering journey:

1. An order's header read **"In production"** while its only card line read
   **"Posted"** — a visible contradiction.
2. In the calendar **list view**, some occasions had a select checkbox and others
   didn't, with no explanation.
3. On **checkout**, cancelling an unfinished order (or removing a released card)
   didn't refresh the list — released cards lingered stale until a manual reload.
4. The checkout copy "up to N cards per order" looked like a hard cap; the user
   expected to be able to send far more.

## Decisions

**1. Order header reflects card progress.** A `BatchOrder` stays `fulfilling`
("In production") until _every_ card is `delivered`, so a `posted` card left the
header contradicting the line. `orderHeaderStatus()` (lib/orders.ts) now refines
the `fulfilling` header to **"On its way"** when every non-cancelled card is
`posted`/`delivered`. Display-only; the underlying status model is unchanged
(the order still completes on full delivery). Applied to the customer order
detail page.

**2. Calendar select cue (keep the gating).** Only an **approved** occasion (a
design has been chosen) can be ticked straight into an order — that gating is
correct: you can't order a card with no artwork. The confusion was that it was
invisible. Occasions still awaiting approval now show a muted amber placeholder
in the checkbox column with a tooltip ("Approve this occasion … to add it to an
order"); clicking the pill still opens the modal's "Review & approve" path. We
kept the gating rather than allowing un-approved occasions into an order.

**3. Checkout re-syncs after cancel/pay.** The checkout page held the approved
occasions as server-rendered props but never re-fetched them after mutations, so
cancelling an unfinished order (which releases its occasions back to `approved`)
or paying from the wallet (which consumes them) left the list stale. Both paths
now call `router.refresh()`, so the list reflects reality without a reload.

**4. Per-order card cap — reconcile drift to the package limits.** Every send
path — checkout batch order, bulk send, and segment send — is capped at the
plan's `batchOrderMaxSize` (`batch-orders.service.ts`). The intended per-order
limits match the subscription packages: **free 10 / pro 200 / centre 500**
(enterprise 5000), and `prisma/seed.ts` already carries those. But an account
was observed capped at **20** — production runs `prisma migrate deploy` only
(never the seed), so a row seeded by an earlier version had drifted. Migration
`20260811140000_align_batch_order_limits` resets the three standard plans to
their package limits (idempotent — a no-op where the values already match). No
schema or code change; the checkout copy is already dynamic (`{maxPerOrder}`).

## Consequences

- The order header no longer contradicts the per-card statuses.
- Customers can see why an upcoming occasion isn't yet orderable, with a path to
  fix it, without weakening the approve-before-order rule.
- Checkout state stays consistent after cancel/pay.
- No API/schema change; web-only. Item 4 tracked for a follow-up once the cap is
  agreed.
