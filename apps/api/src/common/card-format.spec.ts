import {
  CARD_HEIGHT,
  CARD_WIDTH,
  CARD_SIZE_DIMENSIONS_MM,
  PRINT_SAFE_MARGIN_MM,
  fittedCardMm,
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
