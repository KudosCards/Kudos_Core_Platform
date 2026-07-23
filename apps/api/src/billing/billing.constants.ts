import type { Prisma, PostageClass } from "@prisma/client";

/**
 * Base card price: £1.50, **VAT-inclusive**. The plan's cardDiscountPercent is
 * applied on top (Free 0% → £1.50, Pro 10% → £1.35, Centre 15% → £1.275 ≈ the
 * "from £1.28" Centre price). Postage is charged **separately, per card** — see
 * POSTAGE_MINOR — not baked into this. See docs/adr/0008-checkout-pricing.md.
 */
export const CARD_PRICE_MINOR = 150;

/**
 * An extra Centre team seat: £5.00/month, **VAT-inclusive**, charged per seat
 * beyond the 3 the Centre plan includes. Display-only here — Stripe is the
 * source of truth for what's actually billed (this must match the recurring
 * Price behind STRIPE_CENTRE_SEAT_PRICE_ID). See docs/adr/0035-seat-based-billing.md.
 */
export const CENTRE_SEAT_PRICE_MINOR = 500;

/**
 * A postage stamp per card, added on top of the (VAT-inclusive) card price.
 * Royal Mail stamps are VAT-exempt, so there is no VAT to add on postage.
 * One stamp per card: 5 cards = 5 stamps.
 */
export const POSTAGE_MINOR: Record<PostageClass, number> = {
  first_class: 180,
  second_class: 91,
};

/** Applies PlanEntitlement.cardDiscountPercent, rounding to the nearest penny. */
export function computeCardPriceMinor(cardDiscountPercent: Prisma.Decimal | number): number {
  const discountPercent = Number(cardDiscountPercent);
  return Math.round(CARD_PRICE_MINOR * (1 - discountPercent / 100));
}

/** The stamp cost for a single card at the chosen postage class. */
export function computePostageMinor(postageClass: PostageClass): number {
  return POSTAGE_MINOR[postageClass];
}
