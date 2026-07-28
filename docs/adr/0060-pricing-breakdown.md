# 0060 — Itemised checkout pricing with VAT as a separate line

## Status

Accepted

## Context

Every checkout surface (guest basket, member batch-order pay screen, the order
detail page) showed a single **Total** with no breakdown. Buyers asked for a
clearer split — Card subtotal / Discounts / VAT / Postage / Total — and, being
a VAT-registered business, specifically wanted **VAT shown as its own line**.

Card prices are **VAT-inclusive**: the £2.50 charged per card already contains
20% VAT. Plan discounts (`PlanEntitlement.cardDiscountPercent`: free 0%, pro
10%, centre 15%) reduce that inclusive price. Postage (first class £1.80,
second class £0.91) is **VAT-exempt** and charged on top. So the VAT line is a
**decomposition of the card price**, never an amount added on top of the total —
adding it would double-charge the buyer.

Three surfaces had each grown their own pricing maths, and they had drifted: the
guest basket still assumed £1.50/card and omitted postage entirely, while the
server actually charges £2.50/card + second-class postage. The breakdown work
was a chance to remove that drift, not add a fourth copy of it.

## Decision

**One pricing module, one breakdown function, one set of constants** in
`packages/shared-types/src/pricing.ts` — imported by both API and web so a
card ever only costs one thing:

- `CARD_PRICE_MINOR` (250), `POSTAGE_MINOR` (`{ first_class: 180, second_class:
  91 }`), and `VAT_RATE_PERCENT` (20) are the single source of truth. The API's
  `billing.constants` now re-exports `CARD_PRICE_MINOR`/`POSTAGE_MINOR` from
  here instead of defining its own, and `apps/web/src/lib/cart.ts` derives
  `CARD_PRICE_PENCE` from it (fixing the stale £1.50).
- `computePricingBreakdown({ cardCount, cardSubtotalInclVatMinor, postageMinor,
  fullCardPriceMinor? })` returns a `PricingBreakdown` whose lines **reconcile
  exactly to the penny**:
  `cardSubtotalMinor − discountMinor + vatMinor + postageMinor === totalMinor`.
  - `cardSubtotalMinor` is the ex-VAT value at **full** (pre-discount) price, so
    the discount line has something to reduce.
  - `discountMinor` is the ex-VAT gap between full price and what's actually
    charged (0 on the free plan).
  - `vatMinor` is the VAT portion of the *charged* inclusive price
    (`charged − round(charged / 1.2)`), so a discount lowers the VAT too.
  - `totalMinor` is always `cardSubtotalInclVatMinor + postageMinor` — VAT is
    decomposed out of the cards, never added.

**A new authoritative `GET /pricing` endpoint** (`apps/api/src/pricing/`,
`MembershipGuard`) returns the account's real per-card price (after its plan
discount), the full price, postage, and the VAT rate as an `AccountPricing`
object. The member batch-order screen — whose "Pay by card" jumps straight to
Stripe — uses this to show a true itemised **estimate** before payment instead
of guessing client-side. A full-price `FALLBACK_PRICING` covers a failed lookup
(the server stays authoritative at charge time, so the fallback only affects the
on-screen estimate).

**A shared `PricingBreakdownCard`** (`apps/web/src/components/pricing-breakdown.tsx`)
renders the lines consistently across the order detail page and the batch-order
estimate; the guest basket renders the same breakdown inline. The discount line
only appears when there is a discount.

## Consequences

- Buyers see exactly what they pay for, with VAT itemised, meeting the explicit
  request without changing what's charged.
- The guest basket now reflects the real £2.50 + postage price — a latent
  mischarge-on-display bug is gone.
- Pricing constants live in one place; API and web can no longer drift apart.
- VAT is presented correctly for a VAT-inclusive business: a decomposition, so
  the total is unaffected by showing it. Unit tests assert the lines reconcile
  on the free plan, on a discounted plan, and that postage never contributes VAT.
- The `/pricing` endpoint gives the client a single authoritative source for
  per-account pricing, replacing hard-coded guesses on the batch-order screen.
