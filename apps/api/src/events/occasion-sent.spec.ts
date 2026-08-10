import { isOccasionSent, occasionProgress } from "@kudos/shared-types";

/**
 * The order-aware "sent" predicate (ADR 0141). The bug it fixes: an occasion
 * enters `queued` at checkout — before payment — so keying "sent" off occasion
 * status alone showed an abandoned, unpaid order as "Sent" on the calendar.
 */
describe("isOccasionSent", () => {
  it("does NOT count a queued occasion whose order is unpaid", () => {
    expect(isOccasionSent("queued", "draft")).toBe(false);
    expect(isOccasionSent("queued", "pending_payment")).toBe(false);
    expect(isOccasionSent("queued", "cancelled")).toBe(false);
    // No order at all (or the link not loaded) is likewise not sent.
    expect(isOccasionSent("queued", null)).toBe(false);
    expect(isOccasionSent("queued", undefined)).toBe(false);
  });

  it("counts a queued occasion once its order is actually paid", () => {
    expect(isOccasionSent("queued", "paid")).toBe(true);
    expect(isOccasionSent("queued", "fulfilling")).toBe(true);
    expect(isOccasionSent("queued", "completed")).toBe(true);
  });

  it("always counts post-fulfilment statuses (only reachable after payment)", () => {
    for (const status of ["printed", "posted", "delivered"] as const) {
      expect(isOccasionSent(status, null)).toBe(true);
      expect(isOccasionSent(status, "paid")).toBe(true);
    }
  });

  it("never counts pre-checkout statuses", () => {
    for (const status of ["scheduled", "pending_approval", "approved", "skipped"] as const) {
      expect(isOccasionSent(status, "paid")).toBe(false);
    }
  });
});

describe("occasionProgress", () => {
  it("maps skipped, sent (order-aware), and upcoming", () => {
    expect(occasionProgress("skipped", null)).toBe("skipped");
    expect(occasionProgress("queued", "paid")).toBe("sent");
    // The regression: a queued-but-unpaid occasion is upcoming, not sent.
    expect(occasionProgress("queued", "pending_payment")).toBe("upcoming");
    expect(occasionProgress("approved", null)).toBe("upcoming");
    expect(occasionProgress("delivered", null)).toBe("sent");
  });
});
