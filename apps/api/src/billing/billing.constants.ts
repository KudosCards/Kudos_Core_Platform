import type { Prisma } from "@prisma/client";

/**
 * £1.50, VAT- and postage-inclusive (confirmed against the live pricing
 * page — cross-checked against three worked examples there, all matched
 * exactly). PostageClass (first/second class) is a fulfillment preference,
 * not a price driver — it doesn't change this. See docs/adr/0008-checkout-pricing.md.
 */
export const CARD_PRICE_MINOR = 150;

/** Applies PlanEntitlement.cardDiscountPercent, rounding to the nearest penny. */
export function computeCardPriceMinor(cardDiscountPercent: Prisma.Decimal | number): number {
  const discountPercent = Number(cardDiscountPercent);
  return Math.round(CARD_PRICE_MINOR * (1 - discountPercent / 100));
}
