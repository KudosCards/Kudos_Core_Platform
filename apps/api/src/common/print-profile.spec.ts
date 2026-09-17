import {
  DEFAULT_PRINT_PROFILE,
  MAX_BORDERLESS_OVERHANG_MM,
  borderlessShrink,
  foldedSheetMm,
  printProfileSchema,
} from "@kudos/shared-types";

/**
 * The arithmetic that decides how big a card prints. See
 * docs/card-print-quality-plan.md (P4) and ADR 0249.
 */
describe("foldedSheetMm", () => {
  it("folds an A6 card from an A5 landscape sheet", () => {
    // The stock Kudos actually buys: 210 x 148, folded down the middle.
    expect(foldedSheetMm("A6")).toEqual({ widthMm: 210, heightMm: 148 });
  });

  it("derives the sheet from the card rather than hard-coding one size", () => {
    // An A5 card folds from 296 x 210 — near enough A4 landscape to trim from.
    expect(foldedSheetMm("A5")).toEqual({ widthMm: 296, heightMm: 210 });
  });
});

describe("borderlessShrink", () => {
  const SHEET = 210;

  it("draws the sheet full size when no overhang has been measured", () => {
    // 0 is both "not calibrated yet" and the right answer for a printer that
    // isn't enlarging — so it has to be exactly 1, not merely close.
    expect(borderlessShrink(0, SHEET)).toBe(1);
  });

  it.each([0.5, 1, 2, 2.5, 3, MAX_BORDERLESS_OVERHANG_MM])(
    "puts the trim back on the paper edge after a %s mm enlargement",
    (overhang) => {
      // This is the whole purpose, stated as a round trip: the driver enlarges
      // the page until it overhangs by `overhang` on each long edge, so the
      // compensation has to be the exact inverse of that enlargement.
      const enlargement = (SHEET + 2 * overhang) / SHEET;
      expect(borderlessShrink(overhang, SHEET) * enlargement).toBeCloseTo(1, 12);
    },
  );

  it("shrinks — never grows — so a panel can't be pushed off the sheet", () => {
    expect(borderlessShrink(3, SHEET)).toBeLessThan(1);
    expect(borderlessShrink(3, SHEET)).toBeGreaterThan(0.9);
  });

  it("refuses to act on a figure no ruler could produce", () => {
    // A negative reading would *enlarge* the card past the sheet; an absurd one
    // would shrink it to a stamp. Both are a typo, not a measurement.
    expect(borderlessShrink(-5, SHEET)).toBe(1);
    expect(borderlessShrink(1000, SHEET)).toBe(borderlessShrink(MAX_BORDERLESS_OVERHANG_MM, SHEET));
  });

  it("survives a nonsense sheet width instead of dividing by zero", () => {
    expect(borderlessShrink(3, 0)).toBe(1);
  });
});

describe("printProfileSchema", () => {
  it("accepts the bundled default", () => {
    expect(printProfileSchema.safeParse(DEFAULT_PRINT_PROFILE).success).toBe(true);
  });

  it("defaults to the layout this printer needs, uncalibrated and hands-off", () => {
    // Each of these is a deliberate choice: the folded sheet is the only way this
    // printer can make an A6 card; 0 means nobody has measured yet; and the stock
    // in the building is pre-printed, so drawing the footer would overprint it.
    expect(DEFAULT_PRINT_PROFILE).toEqual({
      layout: "folded-sheet",
      borderlessOverhangMm: 0,
      backFooter: "reserved",
    });
  });

  it("rounds a stored overhang to the quarter-millimetre a ruler can show", () => {
    const parsed = printProfileSchema.parse({
      layout: "folded-sheet",
      borderlessOverhangMm: 2.857142857,
      backFooter: "reserved",
    });
    expect(parsed.borderlessOverhangMm).toBe(2.75);
  });

  it("rejects an overhang beyond anything a real driver applies", () => {
    const tooBig = {
      layout: "folded-sheet",
      borderlessOverhangMm: MAX_BORDERLESS_OVERHANG_MM + 0.25,
      backFooter: "reserved",
    };
    expect(printProfileSchema.safeParse(tooBig).success).toBe(false);
  });

  it.each([
    ["a negative overhang", { borderlessOverhangMm: -1 }],
    ["a non-finite overhang", { borderlessOverhangMm: Number.POSITIVE_INFINITY }],
    ["an unknown layout", { layout: "2-up" }],
    ["an unknown footer mode", { backFooter: "sometimes" }],
  ])("rejects %s", (_label, override) => {
    const candidate = { ...DEFAULT_PRINT_PROFILE, ...override };
    expect(printProfileSchema.safeParse(candidate).success).toBe(false);
  });
});
