# ADR 0037 — Provision the extra-seat Stripe Price from the running platform

Status: accepted
Date: 2026-07-24

## Context

The £5/mo extra-seat add-on (ADR 0035) needs a Stripe **Price** object, and its
id wired in. ADR 0036 made that a Railway env var (`STRIPE_CENTRE_SEAT_PRICE_ID`)
plus a script (`create-stripe-prices`) to create the Price. That still requires
someone to run a terminal/CLI where the live Stripe key is available and then set
an env var and redeploy — friction that stalled go-live (no local Railway CLI, no
local key, and this build sandbox is hard-blocked from `api.stripe.com` by egress
policy, so it can't create the Price either).

Key realisation: **the deployed API already holds the live Stripe key and can
reach Stripe** — that's how plan checkout works in production. So the platform can
provision the Price *itself*, on demand, with no dashboard, env var, or redeploy.

## Decision

### A tiny platform-level settings store

New `PlatformSetting` table — a `key → value` store for runtime config the app can
write itself (things that would otherwise need a redeploy). It holds the created
seat Price id under `stripe_centre_seat_price_id`.

### Resolve the seat price: env → DB

`SeatBillingService.resolveSeatPriceId()` returns `STRIPE_CENTRE_SEAT_PRICE_ID`
(env) if set, else the `PlatformSetting` value, else null. Both consumers — the
seat-purchase path (`SubscriptionsService.setExtraSeats`) and the webhook
reconciliation — now go through it, so a stored id activates seats with **no env
var and no redeploy**. An explicit env var still wins, so nothing existing breaks.

### Provision from an ops action

`SeatBillingService.ensureSeatPrice()` — idempotent:
- if an env var provides the id, respect it (create nothing);
- else if we already stored one, reuse it;
- else look up an existing Price by the stable `lookup_key`
  `kudos_centre_seat_monthly` (so it reuses a Price a prior
  `create-stripe-prices` run made), and only if none exists, **create** the £5/mo
  GBP VAT-inclusive recurring Price against this deployment's Stripe account and
  store its id.

Exposed as **platform-admin-only** endpoints on the existing admin surface:
- `GET  /admin/billing/seat-price` — status (`{ priceId, source }`).
- `POST /admin/billing/seat-price` — provision (returns the same shape).

The ops dashboard gains a **"Seat billing (£5/mo add-on)"** panel: it shows
Active/Not-set-up and, when off, an **Enable seat billing** button. One click, by a
platform admin already logged into the live app, creates the Price and switches
seat purchasing on.

## Why this is the right shape

- The action runs where the credentials and network already are (the deployed
  API), not in a sandbox that can't reach Stripe or a laptop that lacks the key.
- It's idempotent across all three activation routes (env var, the script, this
  endpoint), so they can't fight or duplicate the Price.
- `PlatformSetting` generalises to future "flip it on without a redeploy" config.

## Consequences

- A platform admin turns seat billing on from the app in one click — no Stripe
  dashboard, no env var, no redeploy, no terminal.
- Provisioning uses the deployment's own key, so in production it creates a **live**
  Price. It requires that key to permit Prices/Products **write** — a restricted
  key without those scopes returns a clear Stripe error at the button, not a
  silent failure.
- The plan (Pro/Centre) prices still come from env/seed (ADR 0036); this ADR
  scopes in-app provisioning to the seat add-on, whose price the app fully owns.
  The same mechanism could later cover plan prices if wanted.
