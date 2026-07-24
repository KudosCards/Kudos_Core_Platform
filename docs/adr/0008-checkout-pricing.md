# ADR 0008 — Checkout pricing: flat £1.50/card, Stripe Checkout, no wallet/refunds yet

Status: accepted
Date: 2026-07-16

## Context

Phase 3 needed to turn an approved `Occasion` into a paid `BatchOrder`. Two things were
genuinely undecided and couldn't be guessed: the real price to charge, and how payment collection
should work, given live Stripe credentials are already in production.

The live pricing page confirmed a flat **£1.50 per card**, described as VAT- and postage-inclusive
— cross-checked against three worked examples on that page (30/100/250 students at the Starter/
Pro/Centre discount rates), all of which matched exactly. Subscriptions: Free £0, Pro £9.97/mo,
Centre £19.97/mo, both incl. VAT — matching the comment already in `apps/api/prisma/seed.ts`.

## Decision

- **`CARD_PRICE_MINOR = 150`** (pence), with `PlanEntitlement.cardDiscountPercent` (already
  seeded: 0%/10%/15%) applied on top. See `apps/api/src/billing/billing.constants.ts`.
- **`OrderRecipient.postageClass`** (first/second class) is a fulfillment preference only — it
  does not change the price, since the flat £1.50 already includes postage. `BatchOrder.postageMinor`
  is always `0` in this phase.
  _(Superseded — see the 2026-07-17 pricing correction below.)_
- **Stripe Checkout** (hosted redirect), not embedded Elements, for both the batch-order payment
  and the plan subscription. Given live keys are already in place, minimizing custom
  payment-handling code (card entry, 3-D Secure, PCI scope) is the right call for a first payments
  implementation.
- **Card payment only** — `WalletLedgerEntry`/wallet top-up-and-spend is out of scope for this
  phase. The schema already supports it later without changes.
- **No refunds** — a `draft` `BatchOrder` cancels freely (no Stripe call). Once `paid`, it's final
  for this phase; refunds are a follow-up once the charge path is proven reliable.

## Alternatives considered

- **Stripe Elements** embedded checkout — rejected for now: meaningfully more client-side code and
  SCA/3-D-Secure edge cases to get right ourselves, for no functional gain in a first pass. Worth
  revisiting once the platform wants a more on-brand checkout experience.
- **Building wallet and refunds alongside first-time checkout** — rejected: both are genuinely
  separate features (their own state machines, their own Stripe flows) and bundling them in risks
  all three being weaker. Sequencing them as focused follow-ups keeps each one correct.

## Pricing correction (2026-07-17)

Confirmed with the business during live testing: **postage is _not_ baked into the card price**.
The correct model is:

- The **£1.50 card price is VAT-inclusive** and the plan discount still applies on top (Free £1.50,
  Pro £1.35, Centre £1.275 ≈ the advertised "from £1.28").
- **Postage is a separate charge, per card**: one stamp per card — **£1.80 first class, £0.91
  second class** (`POSTAGE_MINOR` in `billing.constants.ts`). Royal Mail stamps are VAT-exempt, so
  no VAT is added on postage. Five cards = five stamps.
- Checkout total = Σ per card `[ tier card price (incl. VAT) + chosen stamp ]`.

`OrderRecipient` now carries a per-line `postageMinor`, `BatchOrder.postageMinor` is the real sum,
and `totalMinor = subtotalMinor + postageMinor` (what Stripe charges). The earlier
"postage-inclusive, `postageMinor` always 0" decision is superseded.

## Consequences

- Pricing logic is centralised in one small, tested function
  (`computeCardPriceMinor`) rather than scattered across the checkout endpoint — any future price
  or discount-rule change touches one place.
- Stripe Checkout means the API never touches raw card data — no PCI SAQ-D scope, no Stripe.js
  dependency in the web app for this phase.
- If real pricing ever changes, `CARD_PRICE_MINOR` and the Stripe Price IDs
  (`PlanEntitlement.stripePriceId`) are the two places to update — not scattered constants.

## Update (2026-07-24) — base card price £1.50 → £2.50

The full-price card is now **£2.50, VAT-inclusive** (was £1.50). `CARD_PRICE_MINOR = 250`; the
plan discount still applies on top — Free £2.50, Pro (10%) £2.25, Centre (15%) £2.125 ≈ the
advertised "from £2.13". Postage is unchanged (a separate stamp per card: £1.80 first class,
£0.91 second). This was a one-line constant change plus the marketing copy and the tests that
assert exact pennies — exactly the "one place to update" this ADR designed for.
