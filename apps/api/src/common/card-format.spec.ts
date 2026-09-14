import {
  BACK_RESERVED_FOOTER_MM,
  CARD_HEIGHT,
  CARD_WIDTH,
  CARD_SIZE_DIMENSIONS_MM,
  CARD_SIZES,
  PRINT_SAFE_MARGIN_MM,
  backReservedFooterTop,
  backReservedFooterUnits,
  fittedCardMm,
  fittedCardInsetMm,
  isInBackReservedFooter,
} from "@kudos/shared-types";

/**
 * The design space is proportioned to A6 (see design-layout.ts CARD_HEIGHT) so
 * the editor is WYSIWYG against print: when the authored card is fitted onto the
 * physical A6 page there is no large vertical letterbox that would shift content
 * down relative to what the customer laid out. These tests pin that property so
 * a future tweak to CARD_HEIGHT can't silently reintroduce the shift.
 */
describe("fittedCardMm", () => {
  it("never distorts — the fitted card keeps the authored aspect ratio", () => {
    const authoredAspect = CARD_HEIGHT / CARD_WIDTH;
    for (const size of ["A6", "A5"] as const) {
      const fit = fittedCardMm(size);
      expect(fit.cardHeightMm / fit.cardWidthMm).toBeCloseTo(authoredAspect, 5);
    }
  });

  it("stays inside the safe margin on every edge", () => {
    const fit = fittedCardMm("A6");
    expect(fit.cardWidthMm).toBeLessThanOrEqual(fit.pageWidthMm - 2 * PRINT_SAFE_MARGIN_MM + 1e-9);
    expect(fit.cardHeightMm).toBeLessThanOrEqual(
      fit.pageHeightMm - 2 * PRINT_SAFE_MARGIN_MM + 1e-9,
    );
  });

  it("nearly fills the A6 safe area vertically — no content-shifting letterbox", () => {
    const { heightMm } = CARD_SIZE_DIMENSIONS_MM.A6;
    const availHeightMm = heightMm - 2 * PRINT_SAFE_MARGIN_MM;
    const fit = fittedCardMm("A6");
    // With the A6-proportioned canvas the residual vertical slack is a couple of
    // millimetres at most (the fixed safe margin, not an aspect mismatch), so the
    // card occupies the vast majority of the available height.
    expect(fit.cardHeightMm).toBeGreaterThan(availHeightMm * 0.95);
    // Regression guard: the old 3:4 canvas left ~10mm of top slack on A6.
    const topSlackMm = (fit.pageHeightMm - fit.cardHeightMm) / 2 - PRINT_SAFE_MARGIN_MM;
    expect(topSlackMm).toBeLessThan(3);
  });
});

/**
 * How far the previewed card sits in from the trim edge.
 *
 * The ops print overlay draws the card inset inside its page, because a browser
 * print has to stay clear of an office printer's unprintable margin. The
 * print-ready PDF has no such inset — the design fills the trim width. An
 * operator looking at the preview is therefore looking at a card with a white
 * border the real output does not have, and the question they open this screen
 * to ask ("is the artwork being cut at the edge?") is exactly the one that
 * border hides. These numbers are what the preview has to say out loud.
 */
describe("fittedCardInsetMm", () => {
  it("is the gap between the fitted card and the page it is centred on", () => {
    for (const size of CARD_SIZES) {
      const fit = fittedCardMm(size);
      const inset = fittedCardInsetMm(size);
      expect(inset.sideMm).toBeCloseTo((fit.pageWidthMm - fit.cardWidthMm) / 2, 6);
      expect(inset.topMm).toBeCloseTo((fit.pageHeightMm - fit.cardHeightMm) / 2, 6);
    }
  });

  it("is the safe margin on the sides, and more than that top and bottom", () => {
    // The fit clamps on width, so the sides land exactly on the margin and the
    // vertical gap absorbs whatever the aspect ratio leaves over. Saying "5mm"
    // for both would be wrong by 2mm on A6 and nearly 3mm on A5.
    for (const size of CARD_SIZES) {
      const inset = fittedCardInsetMm(size);
      expect(inset.sideMm).toBeCloseTo(PRINT_SAFE_MARGIN_MM, 6);
      expect(inset.topMm).toBeGreaterThan(PRINT_SAFE_MARGIN_MM);
    }
  });

  it("reports the A6 and A5 gaps a person would read off a ruler", () => {
    expect(fittedCardInsetMm("A6").topMm).toBeCloseTo(7.08, 2);
    expect(fittedCardInsetMm("A5").topMm).toBeCloseTo(7.79, 2);
  });

  it("is nothing at all when the card is fitted with no margin", () => {
    const inset = fittedCardInsetMm("A6", 0);
    expect(inset.sideMm).toBe(0);
    // Even edge to edge the A6 page is a hair taller than the authored canvas:
    // 450 x 148/105 is 634.29 and the canvas is 634. Four hundredths of a
    // millimetre, split between top and bottom.
    expect(inset.topMm).toBeLessThan(0.05);
  });
});

/**
 * The strip of the card back that is physically already printed with the Kudos
 * logo and QR. Every other check — the editor guide, the print clip — derives
 * from these, so if the conversion is wrong they are all wrong together and
 * consistently, which is the worst way to be wrong.
 */
describe("back reserved footer", () => {
  it("is 30mm of real card at every size", () => {
    for (const size of CARD_SIZES) {
      const { heightMm } = CARD_SIZE_DIMENSIONS_MM[size];
      // Convert the band back out of design units into millimetres.
      const mm = (backReservedFooterUnits(size) * heightMm) / CARD_HEIGHT;
      expect(mm).toBeCloseTo(BACK_RESERVED_FOOTER_MM, 6);
    }
  });

  it("is a different number of units at each size, which is the whole point", () => {
    // The canvas is one fixed space fitted onto the card, so a hardcoded unit
    // count would be 30mm on A6 and 42.5mm on A5 — silently wrong on the size
    // we haven't launched yet.
    expect(backReservedFooterUnits("A6")).toBeCloseTo(128.5, 1);
    expect(backReservedFooterUnits("A5")).toBeCloseTo(90.6, 1);
    expect(backReservedFooterUnits("A6")).not.toBeCloseTo(backReservedFooterUnits("A5"), 1);
  });

  it("measures up from the bottom trim edge", () => {
    for (const size of CARD_SIZES) {
      expect(backReservedFooterTop(size) + backReservedFooterUnits(size)).toBeCloseTo(
        CARD_HEIGHT,
        6,
      );
    }
  });

  it("flags an element that reaches into the band, and only then", () => {
    const top = backReservedFooterTop();
    // Sitting entirely above it — fine.
    expect(isInBackReservedFooter({ y: top - 100, height: 90 })).toBe(false);
    // Its bottom edge just crosses the line — not fine. A box is judged by
    // where it *ends*, not where it starts, or a tall element anchored above
    // the band would print straight through the logo.
    expect(isInBackReservedFooter({ y: top - 10, height: 20 })).toBe(true);
    // Wholly inside the band.
    expect(isInBackReservedFooter({ y: top + 10, height: 20 })).toBe(true);
  });
});
