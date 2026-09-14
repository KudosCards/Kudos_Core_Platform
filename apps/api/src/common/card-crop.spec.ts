import {
  backgroundCropLoss,
  coverCrop,
  coverCropLoss,
  croppedAxis,
  cropLossPercent,
  cropVerdict,
  CARD_HEIGHT,
  CARD_WIDTH,
} from "@kudos/shared-types";

/**
 * A super admin opened a card and said the artwork looked cut off at the edges.
 * It was: a background is centre-cropped to the card's 1:1.409, and nothing
 * anywhere measured how much that discards.
 *
 * The table below is the one reported in docs/card-artwork-crop-plan.md. It is
 * here as tests so the plan and the code cannot quietly disagree — if they ever
 * do, this says so rather than the numbers in a document going stale.
 */
describe("coverCropLoss", () => {
  const CARD = { width: CARD_WIDTH, height: CARD_HEIGHT };

  // [name, natural size, total fraction of the worst axis lost, which axis]
  const TABLE: [string, { width: number; height: number }, number, "width" | "height" | null][] = [
    ["square (1:1)", { width: 1000, height: 1000 }, 0.29, "width"],
    ["4:5 portrait", { width: 1000, height: 1250 }, 0.113, "width"],
    ["3:4 portrait", { width: 1000, height: 1333 }, 0.054, "width"],
    ["5:7 portrait", { width: 1000, height: 1400 }, 0.006, "width"],
    ["2:3 portrait", { width: 1000, height: 1500 }, 0.061, "height"],
    ["landscape 3:2", { width: 1500, height: 1000 }, 0.527, "width"],
  ];

  it.each(TABLE)("loses the reported share of %s", (_name, natural, expected, axis) => {
    const loss = coverCropLoss(natural, CARD);
    expect(Math.max(loss.widthLost, loss.heightLost)).toBeCloseTo(expected, 2);
    expect(croppedAxis(loss)).toBe(axis);
  });

  it("loses nothing at all from artwork at exactly the authored proportion", () => {
    // 900 x 1268 is 450:634 doubled — the only shape where literally nothing is
    // thrown away.
    const loss = coverCropLoss({ width: 900, height: 1268 }, CARD);
    expect(croppedAxis(loss)).toBe(null);
    expect(cropVerdict(loss)).toBe("ok");
  });

  it("loses a rounding hair from true A6 artwork, and calls it ok", () => {
    // Worth knowing rather than assuming: 1050 x 1480 is A6 in tenths of a
    // millimetre, but the authored canvas is 450 x 634 and 450 x 148/105 is
    // 634.29 — so the canvas is a third of a unit shorter than the paper it
    // prints on. Artwork commissioned at true A6 therefore loses about 0.05% of
    // its height, which is four hundredths of a millimetre and rounds to no
    // percent at all. The floor exists for exactly this.
    const loss = coverCropLoss({ width: 1050, height: 1480 }, CARD);
    expect(croppedAxis(loss)).toBe("height");
    expect(loss.heightLost).toBeLessThan(0.001);
    expect(cropLossPercent(loss)).toBe(0);
    expect(cropVerdict(loss)).toBe("ok");
  });

  it("agrees with the crop it describes", () => {
    // The measurement and `coverCrop` must not drift: a number that disagreed
    // with the rectangle actually taken would be worse than no number at all.
    for (const [, natural] of TABLE) {
      const crop = coverCrop(natural, CARD);
      const loss = coverCropLoss(natural, CARD);
      expect(loss.widthLost).toBeCloseTo((natural.width - crop.width) / natural.width, 6);
      expect(loss.heightLost).toBeCloseTo((natural.height - crop.height) / natural.height, 6);
    }
  });

  it("only ever trims one axis", () => {
    for (const [, natural] of TABLE) {
      const loss = coverCropLoss(natural, CARD);
      expect(Math.min(loss.widthLost, loss.heightLost)).toBe(0);
    }
  });

  it("treats a degenerate size as losing nothing rather than dividing by zero", () => {
    expect(coverCropLoss({ width: 0, height: 100 }, CARD)).toEqual({ widthLost: 0, heightLost: 0 });
    expect(coverCropLoss({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({
      widthLost: 0,
      heightLost: 0,
    });
  });
});

describe("backgroundCropLoss", () => {
  it("fits to the whole authored face, since that is what a background fills", () => {
    expect(backgroundCropLoss({ width: 1000, height: 1000 })).toEqual(
      coverCropLoss({ width: 1000, height: 1000 }, { width: CARD_WIDTH, height: CARD_HEIGHT }),
    );
  });
});

describe("cropVerdict", () => {
  it("buckets the real cases the way a person would", () => {
    const of = (width: number, height: number) =>
      cropVerdict(backgroundCropLoss({ width, height }));

    expect(of(1000, 1400)).toBe("ok"); // 5:7 — 0.6%, a hair
    expect(of(1000, 1333)).toBe("noticeable"); // 3:4 — 5.4%
    expect(of(1000, 1250)).toBe("heavy"); // 4:5 — 11.3%
    expect(of(1000, 1000)).toBe("heavy"); // square — 29%
    expect(of(1500, 1000)).toBe("heavy"); // landscape — 52.7%
  });

  it("has a floor, so it does not flag every image on the platform", () => {
    // Almost nothing is authored at exactly 1:1.409. A rule with no floor would
    // fire on all of it and be ignored within a week.
    expect(cropVerdict({ widthLost: 0.019, heightLost: 0 })).toBe("ok");
    expect(cropVerdict({ widthLost: 0.021, heightLost: 0 })).toBe("noticeable");
  });

  it("judges the worst axis, whichever it is", () => {
    expect(cropVerdict({ widthLost: 0, heightLost: 0.3 })).toBe("heavy");
    expect(cropVerdict({ widthLost: 0.3, heightLost: 0 })).toBe("heavy");
  });
});

describe("cropLossPercent", () => {
  it("rounds to something a person reads", () => {
    expect(cropLossPercent(backgroundCropLoss({ width: 1000, height: 1000 }))).toBe(29);
    expect(cropLossPercent({ widthLost: 0, heightLost: 0 })).toBe(0);
  });
});
