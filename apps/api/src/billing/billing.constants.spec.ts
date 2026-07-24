import { Prisma } from "@prisma/client";
import { computeCardPriceMinor, computePostageMinor } from "./billing.constants";

describe("computeCardPriceMinor", () => {
  it("applies no discount for the free plan (0%)", () => {
    expect(computeCardPriceMinor(0)).toBe(250);
  });

  it("applies a 10% discount for the pro plan", () => {
    expect(computeCardPriceMinor(10)).toBe(225);
  });

  it("applies a 15% discount for the centre plan", () => {
    expect(computeCardPriceMinor(15)).toBe(213); // 212.5 rounds to 213
  });

  it("accepts a Prisma.Decimal (the type PlanEntitlement.cardDiscountPercent actually is)", () => {
    expect(computeCardPriceMinor(new Prisma.Decimal("10.00"))).toBe(225);
  });
});

describe("computePostageMinor", () => {
  it("charges £1.80 per card for first class", () => {
    expect(computePostageMinor("first_class")).toBe(180);
  });

  it("charges £0.91 per card for second class", () => {
    expect(computePostageMinor("second_class")).toBe(91);
  });
});
