# 0063 — Header basket indicator for unfinished orders

## Status

Accepted

## Context

A member can start a batch order — selecting approved occasions, filling in
shipping — and leave before paying. That order sits as `draft` or
`pending_payment`, quietly **holding its occasions** (they're moved out of the
approvals queue until checkout completes or the order is cancelled). The only
place to see and resume it was the `/batch-orders` screen itself, which the
member had already navigated away from. User feedback asked for a basket in the
app header for these unfinished purchases so they're not forgotten.

For a signed-in member the "basket" is exactly their unpaid batch orders — the
account app doesn't use the guest localStorage cart (that's for logged-out
buyers, ADR 0025).

## Decision

Surface unfinished orders as a **basket indicator in the app header**, driven by
a count that already fits the account summary the shell fetches.

- **`DashboardSummary` gains `unfinishedOrders`** — a count of batch orders in
  `draft` or `pending_payment`. Computed in `DashboardService.getSummary`
  alongside the existing counts (one more query in the same `Promise.all`, same
  pattern as `activeOrders`). Distinct from `activeOrders`, which also includes
  paid/in-production orders — those aren't something the member still needs to
  act on, so they don't belong in the basket.
- **The app shell renders a `BasketIndicator`** (shopping-cart icon linking to
  `/batch-orders`) in both the desktop and mobile headers. It is **always
  present**, so members have a consistent, familiar way back into an unfinished
  purchase. When there are unfinished orders it lights up with an accent badge
  (capped at "9+") to nudge them to finish; when there's nothing waiting it's a
  quiet, muted icon that still leads to the batch-orders screen.
- The count rides on the summary the `(app)` layout already loads, so there's no
  extra request and it degrades to a muted, unbadged basket if the summary fetch
  fails.

> An earlier revision only showed the basket when the count was > 0. It was made
> always-visible so members can rely on it being in the header — an empty basket
> that's discoverable beats a badge that only appears once it's too late to be
> noticed.

## Consequences

- Members are reminded of orders they started but didn't pay for, from anywhere
  in the app, and can jump straight back to finish — reducing occasions left
  stuck in a draft.
- No new endpoint or client fetch: one extra count on an existing summary.
- The indicator reflects server truth (unpaid batch orders), not a client-side
  cart, so it can't drift from what checkout will actually charge for.
