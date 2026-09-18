import {
  BORDERLESS_SAFETY_MM,
  DEFAULT_PRINT_PROFILE,
  MAX_BORDERLESS_OVERHANG_MM,
  borderlessShiftMm,
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

  it.each([2, 2.5, 3, 3.25, MAX_BORDERLESS_OVERHANG_MM])(
    "leaves exactly the safety margin overhanging after a %s mm enlargement",
    (overhang) => {
      // The purpose, as a round trip. The driver enlarges the page until it
      // overhangs by `overhang` on each long edge; the compensation has to undo
      // that down to `BORDERLESS_SAFETY_MM` — deliberately not to zero, because
      // a sheet-fed printer does not place every sheet identically and
      // correcting exactly turns any wander into a white sliver on a card.
      const shrink = borderlessShrink(overhang, SHEET);
      const enlargement = (SHEET + 2 * overhang) / SHEET;
      const residual = (SHEET * shrink * enlargement - SHEET) / 2;

      // The margin is subtracted in page space, so what survives on paper is
      // that much times the shrink — about 2% less. Asserted exactly rather
      // than with a loose tolerance, because the relationship is the thing
      // worth pinning; the second assertion says the 2% is beneath notice.
      expect(residual).toBeCloseTo(BORDERLESS_SAFETY_MM * shrink, 9);
      // Which across the whole allowed range is within a tenth of the nominal
      // margin — far beneath anything a printer or a ruler can tell apart.
      expect(residual).toBeGreaterThanOrEqual(BORDERLESS_SAFETY_MM * 0.9);
    },
  );

  it.each([0, 0.25, 0.5, 1])("does not correct a %s mm overhang at all", (overhang) => {
    // At or inside the safety band the card is already as close to the paper as
    // we would aim for, so shrinking it further would only make white.
    expect(borderlessShrink(overhang, SHEET)).toBe(1);
  });

  it("shrinks — never grows — so a panel can't be pushed off the sheet", () => {
    expect(borderlessShrink(3, SHEET)).toBeLessThan(1);
    expect(borderlessShrink(3, SHEET)).toBeGreaterThan(0.9);
  });

  it("corrects the figure the first real calibration produced", () => {
    // Left 1.5 mm, right 5 mm: a 3.25 mm overhang per long edge with the sheet
    // sitting 1.75 mm right of centre. Corrected, the card overruns the paper by
    // the safety margin and nothing else.
    const printed = SHEET * borderlessShrink(3.25, SHEET) * ((SHEET + 2 * 3.25) / SHEET);
    const residual = (printed - SHEET) / 2;
    expect(residual).toBeGreaterThan(0.9);
    expect(residual).toBeLessThan(1.1);
    // And the design keeps everything else: 3.25 mm was being lost off each long
    // edge, and now it is one.
    expect(residual).toBeLessThan(3.25 / 3);
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
      borderlessOffsetXMm: 0,
      borderlessOffsetYMm: 0,
      backFooter: "reserved",
    });
  });

  it("rounds a stored overhang to the quarter-millimetre a ruler can show", () => {
    const parsed = printProfileSchema.parse({
      ...DEFAULT_PRINT_PROFILE,
      borderlessOverhangMm: 2.857142857,
    });
    expect(parsed.borderlessOverhangMm).toBe(2.75);
  });

  it("keeps an offset's sign through the same rounding", () => {
    // The sign is the direction. Rounding it away would move the card the wrong
    // way by twice the error.
    const parsed = printProfileSchema.parse({
      ...DEFAULT_PRINT_PROFILE,
      borderlessOffsetXMm: -1.8,
      borderlessOffsetYMm: 0.6,
    });
    expect(parsed.borderlessOffsetXMm).toBe(-1.75);
    expect(parsed.borderlessOffsetYMm).toBe(0.5);
  });

  it("accepts an offset in either direction, unlike an overhang", () => {
    // An overhang is an amount lost and cannot be negative. An offset is a
    // direction as much as a distance.
    expect(
      printProfileSchema.safeParse({ ...DEFAULT_PRINT_PROFILE, borderlessOffsetXMm: -4 }).success,
    ).toBe(true);
    expect(
      printProfileSchema.safeParse({ ...DEFAULT_PRINT_PROFILE, borderlessOverhangMm: -4 }).success,
    ).toBe(false);
  });

  it("rejects an overhang beyond anything a real driver applies", () => {
    const tooBig = {
      ...DEFAULT_PRINT_PROFILE,
      borderlessOverhangMm: MAX_BORDERLESS_OVERHANG_MM + 0.25,
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

describe("borderlessShiftMm", () => {
  it("is nothing when the printer is centred", () => {
    expect(borderlessShiftMm(0, 0.97)).toBe(0);
  });

  it("moves the card the way the offset points", () => {
    // (left − right) ÷ 2 is negative when the printer runs right, and the card
    // has to go left to meet it.
    expect(borderlessShiftMm(-1.75, 1)).toBeLessThan(0);
    expect(borderlessShiftMm(1.75, 1)).toBeGreaterThan(0);
  });

  it("carries the shrink, because the driver enlarges the shift too", () => {
    // A shift of d on the page lands as d ÷ shrink on the paper, so the page
    // shift has to be the paper correction times the shrink.
    const shrink = 0.979;
    const shift = borderlessShiftMm(-1.75, shrink);
    expect(shift / shrink).toBeCloseTo(-1.75, 9);
  });

  it("refuses a figure no calibration sheet could produce", () => {
    expect(borderlessShiftMm(1000, 1)).toBe(MAX_BORDERLESS_OVERHANG_MM);
    expect(borderlessShiftMm(-1000, 1)).toBe(-MAX_BORDERLESS_OVERHANG_MM);
    expect(borderlessShiftMm(Number.NaN, 1)).toBe(0);
  });
});
