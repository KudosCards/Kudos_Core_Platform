import { BatchOrdersService } from "./batch-orders.service";

/** Wrapped rather than aliased: the lint rule rightly objects to detaching a
 *  method from its class, even a static one that never touches `this`. */
const draw = (balanceMinor: number, totalMinor: number): number =>
  BatchOrdersService.walletDrawFor(balanceMinor, totalMinor);

/**
 * How much of an order the wallet pays. The arithmetic is small but it decides
 * what Stripe is charged, and Stripe refuses a charge under 30p — so the edge
 * where a balance *nearly* covers an order is the one worth pinning.
 */
describe("walletDrawFor", () => {
  it("spends nothing when the wallet is empty", () => {
    expect(draw(0, 24_000)).toBe(0);
    // A negative balance shouldn't exist, but arithmetic on one must not
    // produce a "draw" that credits the customer.
    expect(draw(-500, 24_000)).toBe(0);
  });

  it("spends the whole balance when it doesn't cover the order", () => {
    expect(draw(1_000, 24_000)).toBe(1_000);
  });

  it("covers the order exactly when the balance is enough", () => {
    // The caller reads this as "skip Stripe entirely".
    expect(draw(24_000, 24_000)).toBe(24_000);
    expect(draw(50_000, 24_000)).toBe(24_000);
  });

  it("leaves Stripe a chargeable amount when the balance nearly covers it", () => {
    // £240 order, £239.90 balance. Drawing it all leaves a 10p card charge,
    // which Stripe rejects — so draw 10p less and leave exactly 30p to charge.
    expect(draw(23_990, 24_000)).toBe(23_970);
    expect(24_000 - draw(23_990, 24_000)).toBe(30);
    // Exactly at the floor, nothing is trimmed.
    expect(draw(23_970, 24_000)).toBe(23_970);
  });

  it("never draws more than the order", () => {
    for (const [balance, total] of [
      [100, 50],
      [24_000, 24_000],
      [1, 1],
    ]) {
      expect(draw(balance!, total!)).toBeLessThanOrEqual(total!);
    }
  });

  it("never leaves a card charge Stripe would refuse", () => {
    const total = 10_000;
    for (let balance = 0; balance <= total; balance += 7) {
      const applied = draw(balance, total);
      const card = total - applied;
      // Either the wallet covers it outright, or what's left is chargeable.
      expect(card === 0 || card >= 30).toBe(true);
    }
  });
});
