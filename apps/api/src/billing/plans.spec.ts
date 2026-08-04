import {
  PLAN_CATALOG,
  planCardPriceMinor,
  planDisplayName,
  getPlan,
} from "@kudos/shared-types";
import { computeCardPriceMinor } from "./billing.constants";

/**
 * The marketing PLAN_CATALOG (shared-types) quotes a per-card price on every
 * surface; the API charges via computeCardPriceMinor(entitlement discount).
 * These must never disagree — a customer must be charged exactly what the
 * pricing table promised. This ties the two together so a change to one that
 * isn't mirrored in the other fails CI.
 */
describe("PLAN_CATALOG ↔ charged price", () => {
  it("has the three canonical plans, named Free / Pro / Centre", () => {
    expect(PLAN_CATALOG.map((p) => p.id)).toEqual(["free", "pro", "centre"]);
    expect(PLAN_CATALOG.map((p) => p.name)).toEqual(["Free", "Pro", "Centre"]);
  });

  it("quotes a per-card price that matches what the API actually charges", () => {
    for (const plan of PLAN_CATALOG) {
      expect(planCardPriceMinor(plan)).toBe(computeCardPriceMinor(plan.cardDiscountPercent));
    }
  });

  it("keeps the confirmed discounts (Free 0%, Pro 10%, Centre 15%)", () => {
    expect(getPlan("free")?.cardDiscountPercent).toBe(0);
    expect(getPlan("pro")?.cardDiscountPercent).toBe(10);
    expect(getPlan("centre")?.cardDiscountPercent).toBe(15);
  });
});

describe("planDisplayName", () => {
  it("names known plans from the catalog", () => {
    expect(planDisplayName("free")).toBe("Free");
    expect(planDisplayName("pro")).toBe("Pro");
    expect(planDisplayName("centre")).toBe("Centre");
  });

  it("falls back to a capitalised id for anything unknown, and handles null", () => {
    expect(planDisplayName("legacy")).toBe("Legacy");
    expect(planDisplayName(null)).toBe("No plan");
  });
});
