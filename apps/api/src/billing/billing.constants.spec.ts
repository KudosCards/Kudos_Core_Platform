import { Prisma } from "@prisma/client";
import { computeCardPriceMinor } from "./billing.constants";

describe("computeCardPriceMinor", () => {
  it("applies no discount for the free plan (0%)", () => {
    expect(computeCardPriceMinor(0)).toBe(150);
  });

  it("applies a 10% discount for the pro plan", () => {
    expect(computeCardPriceMinor(10)).toBe(135);
  });

  it("applies a 15% discount for the centre plan", () => {
    expect(computeCardPriceMinor(15)).toBe(128); // 127.5 rounds to 128
  });

  it("accepts a Prisma.Decimal (the type PlanEntitlement.cardDiscountPercent actually is)", () => {
    expect(computeCardPriceMinor(new Prisma.Decimal("10.00"))).toBe(135);
  });
});
