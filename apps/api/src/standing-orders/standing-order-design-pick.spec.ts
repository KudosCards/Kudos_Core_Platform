import { pickStandingOrderDesign } from "./standing-order-design-pick";

const POOL = ["design-a", "design-b", "design-c", "design-d"];

function date(year: number): Date {
  return new Date(Date.UTC(year, 5, 14));
}

describe("picking a design from the pool", () => {
  it("always picks something the subscriber actually chose", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(POOL).toContain(pickStandingOrderDesign(POOL, `recipient-${index}`, date(2026)));
    }
  });

  it("gives the same card for the same person and year", () => {
    // Deterministic, so a retried run does not silently change what somebody is
    // sent, and so a test can assert a card rather than a distribution.
    const first = pickStandingOrderDesign(POOL, "recipient-1", date(2026));
    const second = pickStandingOrderDesign(POOL, "recipient-1", date(2026));
    expect(second).toBe(first);
  });

  it("does not send the same person the same card next year", () => {
    // The one repetition a recipient would actually notice.
    const changed = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"].filter(
      (id) =>
        pickStandingOrderDesign(POOL, id, date(2026)) !==
        pickStandingOrderDesign(POOL, id, date(2027)),
    );
    // Not all of them — with four designs a collision is a one-in-four chance
    // and pretending otherwise would be a test that lies. Most is the claim.
    expect(changed.length).toBeGreaterThanOrEqual(6);
  });

  it("spreads people across the pool rather than giving everybody the first one", () => {
    const chosen = new Set(
      Array.from({ length: 100 }, (_, index) =>
        pickStandingOrderDesign(POOL, `recipient-${index}`, date(2026)),
      ),
    );
    expect(chosen.size).toBe(POOL.length);
  });

  it("copes with a pool of one", () => {
    expect(pickStandingOrderDesign(["only"], "anyone", date(2026))).toBe("only");
  });

  it("refuses an empty pool rather than returning undefined", () => {
    // The caller has already refused to run an instruction with an empty pool,
    // so reaching here is a bug — and a bug that returned undefined would put a
    // card with no artwork into the send queue.
    expect(() => pickStandingOrderDesign([], "anyone", date(2026))).toThrow();
  });

  it("does not depend on the day of the year, only the year", () => {
    // The seed is deliberately coarse: a birthday that shifts by a day (a leap
    // year, a corrected date of birth) must not change the card.
    const june = pickStandingOrderDesign(POOL, "recipient-1", new Date(Date.UTC(2026, 5, 14)));
    const december = pickStandingOrderDesign(POOL, "recipient-1", new Date(Date.UTC(2026, 11, 2)));
    expect(december).toBe(june);
  });
});
