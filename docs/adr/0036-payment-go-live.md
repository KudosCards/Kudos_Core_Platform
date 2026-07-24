# ADR 0036 — Turning on live payments (subscription + seat prices from env)

Status: accepted
Date: 2026-07-23

## Context

All the payment code exists and is production-grade (Stripe Checkout for plans,
card orders and wallet top-ups; race-safe transitions; signature-verified,
idempotent webhooks). But **no money can be taken yet** for the recurring
products, because the Stripe *Price* objects the subscription and seat checkouts
reference don't exist, and their ids aren't wired in.

Two friction points blocked go-live:

1. **Price ids reached the app only via the seed.** `STRIPE_PRICE_ID_PRO` /
   `STRIPE_PRICE_ID_CENTRE` fed `prisma/seed.ts`, which wrote
   `PlanEntitlement.stripePriceId`. But `start:deploy` runs `migrate deploy`,
   **not** the seed — so setting those vars in Railway did nothing until someone
   manually re-ran the seed against production.
2. **The Price objects have to be created against the live Stripe account** —
   impossible from CI or a sandbox (no key, no network to Stripe).

## Decision

### Resolve plan Price ids from env at runtime

`SubscriptionsService` now resolves a plan's Price id as **`STRIPE_PRICE_ID_<PLAN>`
env var first, `PlanEntitlement.stripePriceId` as fallback** (`resolvePlanPriceId`).
So setting the var in Railway + redeploy activates a plan with **no re-seed and no
DB write** — the same pattern the extra-seat price (`STRIPE_CENTRE_SEAT_PRICE_ID`)
already uses. The seeded column stays as a fallback so nothing existing breaks.
Price ids are deploy-time config, not domain data — this puts them where the
other Stripe config already lives.

### One command to create the Prices

`apps/api/scripts/create-stripe-prices.mjs` (`pnpm --filter @kudos/api
create-stripe-prices`) creates — idempotently, via a stable `lookup_key` per
price — the three recurring GBP, VAT-inclusive Prices and prints the env lines:

| Env var | Product | Amount |
|---|---|---|
| `STRIPE_PRICE_ID_PRO` | Kudos Cards — Pro | £9.97/mo |
| `STRIPE_PRICE_ID_CENTRE` | Kudos Cards — Centre | £19.97/mo |
| `STRIPE_CENTRE_SEAT_PRICE_ID` | Kudos Cards — Centre extra seat | £5.00/mo |

Run it wherever the Stripe secret key is available (e.g. `railway run …`, which
injects the live key). Re-running reuses existing Prices — safe to run twice.

## Go-live checklist

1. **Create the Prices:** `railway run pnpm --filter @kudos/api create-stripe-prices`
   → copy the three printed lines.
2. **Set them in Railway → Variables** and let it redeploy. Subscriptions and
   seats are now chargeable.
3. **Confirm the webhook** at Stripe → Developers → Webhooks. Endpoint:
   `https://<api-host>/webhooks/stripe`. Its signing secret must equal
   `STRIPE_WEBHOOK_SECRET`. Enabled events (all consumed by the app):
   - `checkout.session.completed` — card orders paid, wallet top-ups credited
   - `checkout.session.expired` — abandoned card order released to draft
   - `payment_intent.payment_failed` — one-off card-order failure (audited)
   - `customer.subscription.created` / `.updated` / `.deleted` — plan + seat sync
4. **Smoke test:** subscribe to Pro, add a Centre seat, buy one card, top up the
   wallet. Confirm each `BatchOrder`/`Subscription`/wallet row lands via the
   webhook (not just the Stripe-side success page).

## Consequences

- Turning a plan on is now "create the Price, set one env var, redeploy" — no
  re-seed, no DB surgery, reversible by clearing the var.
- Live and test are just different `price_…` ids behind the same var; switching
  keys + ids switches modes with no code change.
- The card-order and wallet flows use inline `price_data`, so they needed no
  Price object — they work as soon as the webhook is confirmed.
- Not in scope here (tracked separately): a Stripe Customer Portal for self-serve
  plan changes / card updates / invoices, a dunning cutoff for `past_due`
  subscriptions, and refunds (ADR 0008 still defers these).
