import {
  backgroundCropLoss,
  coverCrop,
  coverCropLoss,
  croppedAxis,
  cropLossPercent,
  cropVerdict,
  revealedCrop,
  cropLossPerEdgeMm,
  idealArtworkPixels,
  printedCropLoss,
  PRINT_RUN_BLEED_MM,
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

/**
 * The geometry behind "show me what is being cut off".
 *
 * A cropped render is the one view guaranteed not to contain the answer to
 * "does this 4.46mm matter?" — the missing part is missing. So the reveal draws
 * the *whole* source, shrunk to fit, and marks the rectangle that actually
 * prints. Everything a person is shown comes from here, so the picture and the
 * percentage beside it cannot disagree.
 *
 * See docs/card-artwork-shape-plan.md, Phase 1.
 */
describe("revealedCrop", () => {
  const CARD = { width: CARD_WIDTH, height: CARD_HEIGHT };
  /** The catalog's shape: 2:3, which is 207 of our 217 designs. */
  const TWO_THREE = { width: 1000, height: 1500 };

  it("fits the whole source inside the box, centred and undistorted", () => {
    const { drawn } = revealedCrop(TWO_THREE, CARD);
    // Contained, not covered: the full 2:3 image inside a 450x634 box is as tall
    // as the box and narrower, with equal slivers either side.
    expect(drawn.height).toBeCloseTo(CARD_HEIGHT, 6);
    expect(drawn.width).toBeCloseTo((CARD_HEIGHT * 1000) / 1500, 4);
    expect(drawn.x).toBeCloseTo((CARD_WIDTH - drawn.width) / 2, 6);
    expect(drawn.y).toBeCloseTo(0, 6);
    // Same scale on both axes — a reveal that stretched the artwork would be
    // lying about the very thing it exists to show.
    expect(drawn.width / 1000).toBeCloseTo(drawn.height / 1500, 9);
  });

  // Both orientations, because they exercise different halves of the mapping: a
  // portrait source is trimmed top and bottom (crop.x is 0) and a landscape one
  // is trimmed at the sides (crop.y is 0). Tested on only one, half the offset
  // arithmetic can be deleted with the suite still green.
  it.each([
    ["portrait 2:3, trimmed top and bottom", TWO_THREE],
    ["landscape 3:2, trimmed at the sides", { width: 1500, height: 1000 }],
  ])("marks a printed window that is exactly the cover-crop — %s", (_name, natural) => {
    const { drawn, printed } = revealedCrop(natural, CARD);
    const crop = coverCrop(natural, CARD);
    const scale = drawn.width / natural.width;

    expect(printed.x).toBeCloseTo(drawn.x + crop.x * scale, 6);
    expect(printed.y).toBeCloseTo(drawn.y + crop.y * scale, 6);
    expect(printed.width).toBeCloseTo(crop.width * scale, 6);
    expect(printed.height).toBeCloseTo(crop.height * scale, 6);
    // The window must sit inside the drawing, or the reveal is marking artwork
    // that is not there.
    expect(printed.x).toBeGreaterThanOrEqual(drawn.x - 1e-9);
    expect(printed.y).toBeGreaterThanOrEqual(drawn.y - 1e-9);
  });

  it("keeps the card square with itself, so content drawn inside is never stretched", () => {
    // The card's own 450x634 is scaled into `printed`; if the two axes scaled
    // differently every element on the face would distort in the reveal.
    for (const natural of [
      TWO_THREE,
      { width: 1500, height: 1000 },
      { width: 1000, height: 1000 },
    ]) {
      const { printed } = revealedCrop(natural, CARD);
      expect(printed.width / CARD_WIDTH).toBeCloseTo(printed.height / CARD_HEIGHT, 9);
    }
  });

  it("marks a band that is the loss the percentage claims", () => {
    // The falsifying tie: if the drawn band and the reported number ever drift,
    // the screen shows one thing and says another.
    const { drawn, printed } = revealedCrop(TWO_THREE, CARD);
    const loss = coverCropLoss(TWO_THREE, CARD);
    expect((drawn.height - printed.height) / drawn.height).toBeCloseTo(loss.heightLost, 9);
    expect((drawn.width - printed.width) / drawn.width).toBeCloseTo(loss.widthLost, 9);
  });

  it("puts the 2:3 band at about 4.5mm top and bottom of a 148mm card", () => {
    const bandMm = (natural: { width: number; height: number }, box: typeof CARD) => {
      const { drawn, printed } = revealedCrop(natural, box);
      return ((printed.y - drawn.y) / drawn.height) * 148;
    };

    // Against the authored canvas, which is the box the reveal actually draws
    // into.
    expect(bandMm(TWO_THREE, CARD)).toBeCloseTo(4.495, 2);

    // And against the trim, which is what the press cuts to. These are not the
    // same number: the canvas is 450 x 634 while 450 x 148/105 is 634.29, so
    // the two boxes are a third of a unit apart. It comes to 0.03mm an edge —
    // the 0.063mm total recorded in docs/card-artwork-shape-plan.md, below what
    // a person or a guillotine can resolve. Pinned in both forms rather than
    // quietly picking the flattering one.
    expect(bandMm(TWO_THREE, { width: 105, height: 148 })).toBeCloseTo(4.46, 2);
  });

  it("has nothing to mark when the artwork is already the card's shape", () => {
    // 900 x 1268 is 450:634 doubled. The reveal must be a no-op here, or it
    // would draw a band on every card in the catalog that is already correct.
    const { drawn, printed } = revealedCrop({ width: 900, height: 1268 }, CARD);
    expect(printed.x).toBeCloseTo(drawn.x, 6);
    expect(printed.y).toBeCloseTo(drawn.y, 6);
    expect(printed.width).toBeCloseTo(drawn.width, 6);
    expect(printed.height).toBeCloseTo(drawn.height, 6);
  });

  it("trims the sides, not the top, for a landscape source", () => {
    const { drawn, printed } = revealedCrop({ width: 1500, height: 1000 }, CARD);
    expect(printed.height).toBeCloseTo(drawn.height, 6);
    expect(printed.width).toBeLessThan(drawn.width);
  });

  it("returns an empty box for a degenerate size rather than dividing by zero", () => {
    const { drawn, printed } = revealedCrop({ width: 0, height: 100 }, CARD);
    expect(drawn).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(printed).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

/**
 * Turning the fraction into the two things a person can act on: how much card
 * is being thrown away, and what to export instead.
 *
 * "6% of the height" is true and almost useless — nobody briefs a designer in
 * percentages of an axis. "4.5mm off the top and the bottom, export at
 * 1240 x 1748" is the same fact in a form somebody can do something about.
 */
describe("cropLossPerEdgeMm", () => {
  it("halves the loss, because a cover-crop takes from both edges", () => {
    // The catalog's 2:3, on A6: 6% of 148mm is 8.9mm, and it comes off in two
    // equal slices because the crop is centred.
    const loss = backgroundCropLoss({ width: 1000, height: 1500 });
    expect(cropLossPerEdgeMm(loss, "A6")).toBeCloseTo(4.49, 1);
  });

  it("measures against the axis that is actually being trimmed", () => {
    // A landscape source loses width, so the number is millimetres off the
    // *sides* — 105mm of card, not 148. Measured against the wrong axis this
    // would overstate the loss by 40%.
    const landscape = backgroundCropLoss({ width: 1500, height: 1000 });
    expect(cropLossPerEdgeMm(landscape, "A6")).toBeCloseTo((105 * 0.5271) / 2, 1);
  });

  it("scales with the card, since a fraction of A5 is more millimetres", () => {
    const loss = backgroundCropLoss({ width: 1000, height: 1500 });
    expect(cropLossPerEdgeMm(loss, "A5")).toBeGreaterThan(cropLossPerEdgeMm(loss, "A6"));
    expect(cropLossPerEdgeMm(loss, "A5") / cropLossPerEdgeMm(loss, "A6")).toBeCloseTo(210 / 148, 3);
  });

  it("is nothing when nothing is lost", () => {
    expect(cropLossPerEdgeMm({ widthLost: 0, heightLost: 0 }, "A6")).toBe(0);
  });
});

describe("idealArtworkPixels", () => {
  it("is the card's own proportion at the print target, so one export clears both checks", () => {
    // The single number to give an artwork supplier. It has to satisfy the crop
    // (right shape) and the resolution pre-flight (enough pixels) at once, or
    // fixing one reintroduces the other.
    // A6 at 300dpi exactly. Not the canvas-exact 1240 x 1747: that is an
    // artefact of the canvas being a third of a unit short of the paper, it is
    // a number no design tool produces, and a supplier would reasonably
    // "correct" it. The 0.06% it costs is inside the floor.
    const a6 = idealArtworkPixels("A6");
    expect(a6).toEqual({ width: 1240, height: 1748 });
    expect(cropVerdict(backgroundCropLoss(a6))).toBe("ok");
    expect(cropLossPercent(backgroundCropLoss(a6))).toBe(0);
  });

  it("is 300dpi at the card's real millimetres", () => {
    for (const size of ["A6", "A5"] as const) {
      const { width } = idealArtworkPixels(size);
      const widthMm = size === "A6" ? 105 : 148;
      expect(width / (widthMm / 25.4)).toBeCloseTo(300, 0);
    }
  });

  it("loses nothing to the crop at either size", () => {
    for (const size of ["A6", "A5"] as const) {
      expect(cropVerdict(backgroundCropLoss(idealArtworkPixels(size)))).toBe("ok");
    }
  });
});

/**
 * Measuring the geometry we actually print, rather than the one we draw on
 * screen.
 *
 * `backgroundCropLoss` fits artwork to the authored 450x634 canvas. The renderer
 * does not: it cover-crops the background over the whole **page**, which equals
 * the trim only because the one shipping path passes `bleedMm: 0`. `renderPdf`
 * still defaults to 3mm, and the geometry module exists precisely so a print
 * house that trims can be added later.
 *
 * On such a path the background is scaled to fill a page 6mm larger each way and
 * then cut back to the card, so a 2:3 source loses 11.1% of its height and 5.4%
 * of its width — `heavy` — while every surface would go on saying 6%.
 * See docs/card-artwork-shape-plan.md, D5.
 */
describe("printedCropLoss", () => {
  const TWO_THREE = { width: 1000, height: 1500 };

  it("is the plain cover-crop into the trim when nothing bleeds", () => {
    // What we ship today. The page is the card, so there is no second cut.
    const loss = printedCropLoss(TWO_THREE, { size: "A6", bleedMm: 0 });
    expect(loss).toEqual(coverCropLoss(TWO_THREE, { width: 105, height: 148 }));
    expect(cropLossPercent(loss)).toBe(6);
  });

  it("agrees with the on-screen measurement to within a rounding hair", () => {
    // The preview crops into the canvas and the press crops into the paper, and
    // those are a third of a design unit apart. Tied together here so the gap
    // stays the 0.06mm it is rather than quietly becoming something else.
    const onScreen = backgroundCropLoss(TWO_THREE);
    const printed = printedCropLoss(TWO_THREE, { size: "A6", bleedMm: PRINT_RUN_BLEED_MM });
    expect(Math.abs(onScreen.heightLost - printed.heightLost) * 148).toBeLessThan(0.07);
  });

  it("counts the trim as well as the crop once a page bleeds", () => {
    // The numbers in the plan. Both axes lose: the height to the cover-crop and
    // then the cut, the width to the cut alone.
    const loss = printedCropLoss(TWO_THREE, { size: "A6", bleedMm: 3 });
    expect(loss.heightLost).toBeCloseTo(0.1111, 3);
    expect(loss.widthLost).toBeCloseTo(0.0541, 3);
    expect(cropVerdict(loss)).toBe("heavy");
  });

  it("would have been reported as half of what it is", () => {
    // The falsifying comparison, stated as a test so the trap cannot reopen
    // quietly: measured against the canvas, a bleed path reads 6%.
    const bleeding = printedCropLoss(TWO_THREE, { size: "A6", bleedMm: 3 });
    expect(cropLossPercent(backgroundCropLoss(TWO_THREE))).toBe(6);
    expect(cropLossPercent(bleeding)).toBe(11);
  });

  it("takes something even from artwork at the ideal size, once there is bleed", () => {
    // Worth knowing before anyone turns bleed on: the background is scaled to
    // fill a larger page and then cut back, so "correctly sized" artwork is not
    // immune. Artwork for a trimming print house has to be supplied oversized.
    const ideal = idealArtworkPixels("A6");
    expect(cropVerdict(printedCropLoss(ideal, { size: "A6", bleedMm: 0 }))).toBe("ok");
    expect(cropLossPercent(printedCropLoss(ideal, { size: "A6", bleedMm: 3 }))).toBeGreaterThan(4);
  });

  it("is what the print run actually asks for", () => {
    // The shipping bleed is shared, not a literal in the PDF service, so the
    // measurement and the renderer cannot drift apart.
    expect(PRINT_RUN_BLEED_MM).toBe(0);
  });

  it("treats a degenerate size as losing nothing rather than dividing by zero", () => {
    expect(printedCropLoss({ width: 0, height: 100 }, { size: "A6", bleedMm: 0 })).toEqual({
      widthLost: 0,
      heightLost: 0,
    });
  });
});
