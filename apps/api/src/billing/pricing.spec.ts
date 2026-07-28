import { CARD_PRICE_MINOR, POSTAGE_MINOR, computePricingBreakdown } from "@kudos/shared-types";

describe("computePricingBreakdown", () => {
  it("decomposes a free-plan order (no discount) with the lines reconciling to the total", () => {
    // 3 cards at full price (£2.50 incl VAT) + 3 second-class stamps.
    const cardSubtotal = 3 * CARD_PRICE_MINOR; // 750
    const postage = 3 * POSTAGE_MINOR.second_class; // 273
    const b = computePricingBreakdown({
      cardCount: 3,
      cardSubtotalInclVatMinor: cardSubtotal,
      postageMinor: postage,
    });

    expect(b.discountMinor).toBe(0);
    expect(b.vatMinor).toBe(cardSubtotal - Math.round(cardSubtotal / 1.2)); // = 750 - 625 = 125
    expect(b.postageMinor).toBe(postage);
    expect(b.totalMinor).toBe(cardSubtotal + postage); // 1023
    // Lines reconcile exactly.
    expect(b.cardSubtotalMinor - b.discountMinor + b.vatMinor + b.postageMinor).toBe(b.totalMinor);
  });

  it("shows the plan discount and still reconciles (Centre 15% → £2.13/card charged)", () => {
    // 2 cards charged at 213 each (15% off 250), first-class stamps.
    const cardSubtotal = 2 * 213; // 426
    const postage = 2 * POSTAGE_MINOR.first_class; // 360
    const b = computePricingBreakdown({
      cardCount: 2,
      cardSubtotalInclVatMinor: cardSubtotal,
      postageMinor: postage,
    });

    expect(b.discountMinor).toBeGreaterThan(0);
    // Card subtotal (ex VAT, full price) minus discount equals the charged net.
    const chargedNet = Math.round(cardSubtotal / 1.2);
    expect(b.cardSubtotalMinor - b.discountMinor).toBe(chargedNet);
    expect(b.cardSubtotalMinor - b.discountMinor + b.vatMinor + b.postageMinor).toBe(b.totalMinor);
    expect(b.totalMinor).toBe(cardSubtotal + postage);
  });

  it("treats postage as VAT-exempt — VAT comes only from the cards", () => {
    const b = computePricingBreakdown({
      cardCount: 1,
      cardSubtotalInclVatMinor: CARD_PRICE_MINOR,
      postageMinor: 500, // arbitrary postage
    });
    // VAT is exactly the card's inclusive-price VAT portion, unaffected by postage.
    expect(b.vatMinor).toBe(CARD_PRICE_MINOR - Math.round(CARD_PRICE_MINOR / 1.2));
  });
});
