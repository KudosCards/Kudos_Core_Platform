import {
  artworkTargetLabel,
  backgroundArtworkVerdict,
  idealArtworkPixels,
  judgeableBackgroundUrls,
  MAX_DECODE_PIXELS,
  type DesignDocument,
} from "@kudos/shared-types";

/**
 * The one rule both halves of the artwork gate share — the browser's refusal
 * before upload and the API's at the save. See ADR 0248.
 */
describe("backgroundArtworkVerdict", () => {
  const A6 = idealArtworkPixels("A6");

  it("accepts the size we ask everyone to export at", () => {
    // If the number in every refusal message were itself refused, the gate would
    // be telling people to do something that does not work.
    expect(backgroundArtworkVerdict(A6)).toBeNull();
    expect(backgroundArtworkVerdict(idealArtworkPixels("A5"), "A5")).toBeNull();
  });

  it("accepts an A5 master on an A6 card — same shape, more pixels than needed", () => {
    expect(backgroundArtworkVerdict(idealArtworkPixels("A5"), "A6")).toBeNull();
  });

  it("refuses the catalog's 2:3 shape, with the loss the shape plan measured", () => {
    // 207 of 217 catalog designs are authored at 2:3 and lose 6% of their
    // height — 4.46mm off the top and 4.46mm off the bottom. That measurement is
    // why this gate exists, so the message has to reproduce it.
    const refusal = backgroundArtworkVerdict({ width: 1240, height: 1860 });

    expect(refusal?.reason).toBe("shape");
    expect(refusal?.message).toContain("6% of its height");
    expect(refusal?.message).toMatch(/4\.[45]mm off each of the top and bottom/);
    expect(refusal?.message).toContain("1240 × 1748 pixels (A6 at 300 dpi)");
  });

  it("refuses a square source, naming the sides rather than the top and bottom", () => {
    const refusal = backgroundArtworkVerdict({ width: 1500, height: 1500 });

    expect(refusal?.reason).toBe("shape");
    expect(refusal?.message).toContain("of its width");
    expect(refusal?.message).toContain("off each side");
  });

  it("forgives a true A6 export against the 450x634 canvas", () => {
    // The canvas is 634 where 450 x 148/105 is 634.29 — a third of a unit, which
    // CROP_OK_BELOW exists to forgive. A gate that failed here would refuse the
    // very file it tells people to produce.
    expect(backgroundArtworkVerdict(A6)?.reason).toBeUndefined();
  });

  it("refuses artwork that is the right shape but too few pixels", () => {
    // 620 x 874 is exactly half of the target: correct shape, 150 dpi.
    const refusal = backgroundArtworkVerdict({ width: 620, height: 874 });

    expect(refusal?.reason).toBe("resolution");
    expect(refusal?.message).toContain("150 dots per inch");
    expect(refusal?.message).toContain("1240 × 1748");
  });

  it("draws the resolution line exactly where the existing pre-flight draws it", () => {
    // The gate is no stricter than the warning it replaces: it reuses
    // printDpiVerdict, whose rule is "at or below 200 is low". So 199.9 dpi is
    // refused and 200.1 is not — pinned from both sides, because a gate that
    // drifted from the pre-flight would refuse artwork the product has always
    // accepted while the editor said it was fine.
    expect(backgroundArtworkVerdict({ width: 827, height: 1165 })?.reason).toBe("resolution");
    expect(backgroundArtworkVerdict({ width: 828, height: 1166 })).toBeNull();
  });

  it("refuses more pixels than the engine will decode", () => {
    const side = Math.ceil(Math.sqrt(MAX_DECODE_PIXELS)) + 1000;
    const refusal = backgroundArtworkVerdict({ width: side, height: side });

    expect(refusal?.reason).toBe("too-many-pixels");
  });

  it("says nothing about an image it could not measure", () => {
    // "We could not read it" is not "it is wrong". The renderer already skips
    // what it cannot decode, and refusing here would turn a failed measurement
    // into a customer's problem.
    expect(backgroundArtworkVerdict({ width: 0, height: 0 })).toBeNull();
    expect(backgroundArtworkVerdict({ width: -1, height: 100 })).toBeNull();
  });

  it("names the same fix whatever the reason", () => {
    const target = artworkTargetLabel("A6");
    const wrongShape = backgroundArtworkVerdict({ width: 1240, height: 1860 });
    const tooSmall = backgroundArtworkVerdict({ width: 620, height: 874 });

    expect(wrongShape?.message).toContain(target);
    expect(tooSmall?.message).toContain(target);
  });
});

describe("judgeableBackgroundUrls", () => {
  const doc = (...urls: (string | null)[]): DesignDocument =>
    ({
      version: 1,
      pages: urls.map((url, i) => ({
        name: ["front", "inside-left", "inside-right", "back"][i] ?? "back",
        elements: [],
        ...(url ? { background: { type: "image", assetUrl: url } } : {}),
      })),
    }) as DesignDocument;

  const MINE = "https://store.test/storage/v1/object/public/design-assets/u/mine.png";
  const OURS = "https://store.test/storage/v1/object/public/design-assets/catalog/KC-1.png";

  it("judges a background the member has just added", () => {
    expect(judgeableBackgroundUrls(doc(MINE), doc(null))).toEqual([MINE]);
  });

  it("leaves a background the design already carried alone", () => {
    // Accepted once. Refusing it on a later save would trap the customer in a
    // design they can neither fix nor keep.
    expect(judgeableBackgroundUrls(doc(MINE), doc(MINE))).toEqual([]);
  });

  it("skips catalog artwork, which is not the customer's to re-export", () => {
    expect(judgeableBackgroundUrls(doc(OURS), doc(null))).toEqual([]);
  });

  it("judges each distinct URL once, however many faces use it", () => {
    expect(judgeableBackgroundUrls(doc(MINE, MINE, MINE), doc(null))).toEqual([MINE]);
  });

  it("judges everything when there is no previous document", () => {
    expect(judgeableBackgroundUrls(doc(MINE))).toEqual([MINE]);
  });
});
