# 0190 — An unfinished payment is still a payment

## Status

Accepted — implemented. From an external code review (finding 14 of 37).

## Context

`createCheckout` refuses a second subscription for an account that already has
one, because changing plans in place isn't built: two live Stripe subscriptions
would double-bill, and `Account.planId` would flap between whichever webhook
landed last. The guard asked:

```ts
status: { in: ["active", "trialing", "past_due"] }
```

That set is "paying". It is not "chargeable". A subscription whose first payment
needs SCA/3DS is created by Stripe as `incomplete`, and Stripe holds the open
invoice for roughly 23 hours: if the customer's bank later completes the
challenge, the subscription becomes `active` and the invoice is paid. An
`incomplete` row is therefore not a dead row — it is a billing relationship that
has not made up its mind.

So a customer who started checkout, was bounced to their bank, gave up, and came
back to try again walked straight past the guard. They now had two subscriptions
in flight. If the abandoned one settled, they were billed twice for the same
plan, and the two `subscription.created` webhooks fought over `Account.planId`.

The failing test written first reproduced exactly that: the second checkout
returned `201 Created` with the `incomplete` subscription still live and nothing
cancelled.

Adding `incomplete` to the guard was the obvious fix and the wrong one. Blocking
strands the customer behind a subscription they never completed and cannot see —
they would have to contact support to buy the product. The status is ambiguous
precisely because it can go either way, and the resolution has to remove the
ambiguity rather than punish the customer for it.

## Decision

Three status sets are named once, in `packages/shared-types/src/billing.ts`, and
the question each site is asking decides which it uses:

- `PAYING_SUBSCRIPTION_STATUSES` — `active`, `trialing`, `past_due`. The
  customer is, or should be, paying us. This is what "has a subscription" means
  to the product.
- `SETTLING_SUBSCRIPTION_STATUSES` — `incomplete`. Not paid, but Stripe may
  still complete it unprompted.
- `CHARGEABLE_SUBSCRIPTION_STATUSES` — the union. Anything that could still
  result in money moving.

The checkout guard asks the chargeable set, then splits on the answer:

- A **paying** subscription blocks outright, as before.
- An **`incomplete`** one is cancelled in Stripe first, marked `canceled`
  locally, audit-logged, and only then is a new checkout minted.

If that cancel fails, the retry is refused with a `409` rather than proceeding.
A failed cancel means the old subscription is still free to settle, and letting
a second one through anyway would be exactly the double-billing the guard
exists to prevent. `resource_missing` is the one tolerated error: already gone
on Stripe's side is the outcome we wanted.

`setExtraSeats` keeps the **paying** set, deliberately, with a comment saying
why: seats added to a subscription that has not settled would only ever be
billed if it later completed, and "there is nothing to add them to yet" is the
honest answer.

## The same bug, unreported, in account deletion

The review named one site. Grepping the literal `["active", "trialing",
"past_due"]` found three, and the third was the same bug with worse
consequences. `accounts.service.ts` cancels subscriptions before deleting an
account — "never delete an account we might keep charging", as its comment
says — and it skipped `incomplete`. A customer who abandoned an SCA challenge
and then deleted their account could have that subscription settle afterwards
and be charged, with no account left to cancel it from and no record on our side
to explain the charge. It now asks `isChargeableSubscriptionStatus`, and a test
covers both halves: the `incomplete` subscription is cancelled, the `canceled`
one is left alone.

## Consequences

- The abandoned-3DS retry, previously a double-billing window, now cleans up
  after itself. The customer sees a working checkout; the stranded subscription
  is gone before the new one exists.
- A cancel that cannot be confirmed blocks the retry. That is a worse
  experience than a checkout page and the right trade: the customer can retry in
  a moment, whereas a double charge needs a refund and an apology.
- `subscription_incomplete_cancelled` appears in the audit log with
  `reason: "superseded_by_new_checkout"`, so the cancellation is attributable
  rather than mysterious.
- The three sets are now named things rather than a repeated literal. A fourth
  site asking this question has to pick one, which is the point.

Four mutations were run against the tests: narrowing the checkout guard back to
paying-only, swallowing the failed cancel, cancelling unconditionally instead of
only `incomplete`, and reverting the deletion loop. Each was caught.
