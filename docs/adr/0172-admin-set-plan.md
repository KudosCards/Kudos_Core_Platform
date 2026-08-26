# 0172 — Kudos HQ can set a plan by hand, unless Stripe owns it

## Status

Accepted — implemented.

## Context

An account's plan drives everything it is allowed to do: the recipient cap, the
cards-per-order cap, the card discount, auto-send, custom artwork, team seats and
QR message pages all read from `PlanEntitlement` keyed on `Account.planId`.

Nothing in the ops console could change it. Every reference to `planId` under
`apps/api/src/admin/` was a read — grouping for KPIs, filtering the subscriber
list, displaying the plan on a customer. `planId` had exactly three writers:

| Writer | What it does |
| --- | --- |
| `accounts.service.ts` | signup → `"free"` |
| `guest-orders.service.ts` | guest purchase → `"free"` |
| `webhooks.service.ts` | Stripe subscription event → the subscribed plan |

So a plan could only be changed by taking a payment. That is right for customers
and wrong for two real cases: our own internal and test accounts, which need paid
entitlements and will never pay, and a customer we want to comp.

The workaround was a hand-written `UPDATE` against production, which is
unaudited, easy to get wrong, and — as below — silently reversible.

## Decision

`POST /admin/customers/:id/plan` sets `Account.planId` directly. Super-admin
only, a reason required, audited as `plan_set_by_admin` with the from/to plans.

**It refuses any account with a live Stripe subscription.** This is the decision
that makes the rest safe. `webhooks.service.ts` rewrites `planId` on *every*
subscription event, so an override on a subscribed account would be reverted the
next time Stripe said anything about it — silently, possibly weeks later, with
the entitlements vanishing under someone who is paying. An override that can be
undone behind your back is worse than no override, so the refusal is a 409 that
names Stripe as the place to make the change instead. `canceled` is the one
status that has released the account back to us; the endpoint allows that.

The ops UI reads the same condition from `Customer360.subscription` and replaces
the control with an explanation, so an operator learns why before typing rather
than after submitting.

**The plan is validated against `PlanEntitlement`, not a hardcoded list.** A plan
added later works with no code change, and — more importantly — a typo'd plan is
refused. Left unchecked it would strand the account on a `planId` that
`EntitlementsService` cannot resolve, which throws `NotFoundException` on every
send: a silent, total outage for that customer from a one-character mistake. The
404 names the configured plans.

**Moving to a plan without team seats clears `extraSeats`.** This mirrors what
the webhook already does on cancellation. Without it a downgraded account keeps
an invite allowance its new plan does not include.

**No idempotency key**, unlike the wallet adjustment. That one is additive, so a
double-submit credits twice; setting a plan is idempotent by nature — applying
`pro` twice leaves the account on `pro`.

## Consequences

An account whose plan was set here has paid entitlements and no subscription, so
it contributes nothing to subscription revenue while consuming plan limits. That
is the intended trade for an internal account and an accepted one for a comp;
the audit entry and its reason are what distinguish the two after the fact.

This does not create, cancel or alter anything in Stripe. It is deliberately a
local override and nothing more — which is exactly why it steps aside whenever
Stripe has an opinion.

Each guard was verified by removing it and watching the right test fail: without
the live-subscription check the refusal case passes when it should not; without
the plan validation the typo case is accepted; without the seat reset a
downgraded account keeps its paid seats.
