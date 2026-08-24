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
