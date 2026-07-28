import type { PostageClass } from "./enums";

/**
 * Checkout pricing — the single source of truth for the amounts and for turning
 * them into an itemised breakdown (card subtotal / discount / VAT / postage /
 * total) that the web renders identically wherever a price is shown.
 *
 * Card prices are **VAT-inclusive** (UK 20%); Royal Mail postage is **VAT-exempt**.
 * So VAT is shown as a *decomposition* of the inclusive card price, never added
 * on top — the total is unchanged. See docs/adr/0008-checkout-pricing.md and
 * docs/adr/0060-pricing-breakdown.md.
 */

/** UK standard VAT rate, as a whole-number percent. */
export const VAT_RATE_PERCENT = 20;

/** Full card price, VAT-inclusive, before any plan discount (pence). */
export const CARD_PRICE_MINOR = 250;

/** One postage stamp per card, VAT-exempt (pence). */
export const POSTAGE_MINOR: Record<PostageClass, number> = {
  first_class: 180,
  second_class: 91,
};

/** The account's live per-card pricing, so the web can show an exact checkout
 * estimate (the plan discount is applied server-side). Returned by GET /pricing. */
export interface AccountPricing {
  /** Discounted, VAT-inclusive price for one card on this account's plan. */
  cardPriceMinor: number;
  /** The plan's card discount, as a whole-number percent. */
  cardDiscountPercent: number;
  /** Full VAT-inclusive card price before discount (CARD_PRICE_MINOR). */
  fullCardPriceMinor: number;
  /** Per-card postage stamp by class (VAT-exempt). */
  postageMinor: Record<PostageClass, number>;
  vatRatePercent: number;
}

/** An itemised, VAT-decomposed price breakdown. Every field is in pence. The
 * lines reconcile exactly: cardSubtotal − discount + vat + postage = total. */
export interface PricingBreakdown {
  cardCount: number;
  /** Full-price card subtotal, **ex VAT**, before any plan discount. */
  cardSubtotalMinor: number;
  /** Plan discount, ex VAT (≥ 0; 0 on the free plan). */
  discountMinor: number;
  /** VAT on the discounted card total (postage is exempt, so none from postage). */
  vatMinor: number;
  vatRatePercent: number;
  /** Postage (VAT-exempt). */
  postageMinor: number;
  /** cardSubtotal − discount + vat + postage — what's actually charged. */
  totalMinor: number;
}

/**
 * Build the breakdown from the authoritative amounts: the number of cards, the
 * **charged** (discounted, VAT-inclusive) card total, and the postage total.
 * The discount line is inferred from the full price × count, so no discount
 * percentage needs to be passed in. Lines reconcile to the total to the penny.
 */
export function computePricingBreakdown(input: {
  cardCount: number;
  /** The charged, discounted, VAT-inclusive card total (e.g. order.subtotalMinor). */
  cardSubtotalInclVatMinor: number;
  postageMinor: number;
  /** Full VAT-inclusive card price; defaults to CARD_PRICE_MINOR. */
  fullCardPriceMinor?: number;
}): PricingBreakdown {
  const full = input.fullCardPriceMinor ?? CARD_PRICE_MINOR;
  const divisor = 1 + VAT_RATE_PERCENT / 100;

  // Decompose the charged (VAT-inclusive) card total into net + VAT.
  const chargedNetMinor = Math.round(input.cardSubtotalInclVatMinor / divisor);
  const vatMinor = input.cardSubtotalInclVatMinor - chargedNetMinor;

  // The full (pre-discount) net subtotal, so the discount line reconciles:
  // cardSubtotal − discount == chargedNet, exactly.
  const fullNetMinor = Math.round((input.cardCount * full) / divisor);
  const discountMinor = Math.max(0, fullNetMinor - chargedNetMinor);

  return {
    cardCount: input.cardCount,
    cardSubtotalMinor: fullNetMinor,
    discountMinor,
    vatMinor,
    vatRatePercent: VAT_RATE_PERCENT,
    postageMinor: input.postageMinor,
    totalMinor: input.cardSubtotalInclVatMinor + input.postageMinor,
  };
}
