# 0128 — Tell every buyer we only stock A6 (for now)

## Status

Accepted

## Context

We currently print a single card size — **A6 (105 × 148 mm)** — with other sizes
planned later. Nothing in the product said so: the card library, the card
preview and every checkout summary were silent on size, so a customer could
browse, personalise and pay without ever learning what physical size they were
buying. Until we actually offer a choice, the honest thing is to state the one
size we stock, everywhere a card is chosen or bought.

## Decision

Surface a single, consistent "all cards are A6" notice at every point a
customer picks or purchases a card, driven from one source of truth.

1. **One source of truth for the fact and the copy.** A new
   `packages/shared-types/src/card-format.ts` exports `CARD_SIZE_CODE` (`"A6"`),
   `CARD_SIZE_DIMENSIONS` (`"105 × 148 mm"`), `CARD_SIZE_LABEL`
   (`"A6 (105 × 148 mm)"`) and a ready `CARD_SIZE_NOTICE` sentence
   ("All cards are printed A6 (105 × 148 mm). More sizes are coming soon.").
   Every surface reads these, so the wording never drifts and the whole notice
   retires from one place when more sizes ship.

2. **Guaranteed at the point of payment.** The notice renders inside the shared
   `PricingBreakdownCard`, which is the single component every checkout/summary
   surface already uses — basket (guest one-off), the bulk-send composer, the
   guided first-order wizard, guest send and the order detail. Putting it there
   means no purchase path can omit it, and a future surface that shows the price
   inherits it for free.

3. **Visible while browsing too.** The public card library page carries the
   notice as a chip under its intro, and the card preview page adds "Printed A6
   (105 × 148 mm) — more sizes coming soon" to its feature list, so the size is
   known before a customer ever reaches checkout.

## Consequences

- Every buyer sees the size before paying, on both the browse and checkout
  journeys — no one can purchase without being told it's A6.
- It's presentational only: no schema, API, or pricing change, and the card
  design space (450 × 600 units, an A6-proportioned 3:4) is unchanged.
- When we introduce more sizes, this becomes the place to turn a fixed notice
  into a real size choice — the constants and the single insertion points are
  already centralised.
