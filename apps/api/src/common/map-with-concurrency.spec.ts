import { chunked, mapWithConcurrency } from "./map-with-concurrency";

describe("chunked", () => {
  it("splits into consecutive runs, in order", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("keeps a short final run rather than padding it", () => {
    expect(chunked([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it("returns nothing for nothing", () => {
    expect(chunked([], 4)).toEqual([]);
  });

  it("yields one run when the window is larger than the batch", () => {
    expect(chunked([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("refuses to loop forever on a nonsense window", () => {
    // `size` reaching 0 through a config change would spin on `start += 0`.
    // Everything in one run is the safe reading: no windowing, not no work.
    expect(chunked([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
    expect(chunked([1, 2, 3], -1)).toEqual([[1, 2, 3]]);
  });

  it("preserves every item exactly once", () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    expect(chunked(items, 4).flat()).toEqual(items);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
      },
    );
    expect(peak).toBe(3);
  });

  it("returns results in input order, not completion order", async () => {
    const out = await mapWithConcurrency([30, 1, 20], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(out).toEqual([30, 1, 20]);
  });
});
