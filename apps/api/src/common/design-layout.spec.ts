import {
  CARD_HEIGHT,
  CARD_SAFE_MARGIN,
  CARD_WIDTH,
  clampElementPosition,
  isOutsideSafeArea,
  textWrapWidth,
} from "@kudos/shared-types";

describe("design layout guard rails", () => {
  describe("clampElementPosition", () => {
    it("keeps a sized element fully on the card", () => {
      // Dragged far past the bottom-right; clamps so the whole box stays on.
      expect(clampElementPosition({ x: 999, y: 999 }, { width: 100, height: 50 })).toEqual({
        x: CARD_WIDTH - 100,
        y: CARD_HEIGHT - 50,
      });
    });

    it("clamps negative origins back to the top-left", () => {
      expect(clampElementPosition({ x: -40, y: -40 }, { width: 100, height: 50 })).toEqual({
        x: 0,
        y: 0,
      });
    });

    it("leaves an in-bounds element where it is", () => {
      expect(clampElementPosition({ x: 120, y: 200 }, { width: 100, height: 50 })).toEqual({
        x: 120,
        y: 200,
      });
    });

    it("keeps at least a sliver on-card when a dimension is unknown (auto-height text)", () => {
      const clamped = clampElementPosition({ x: 999, y: 999 }, { width: 200 });
      expect(clamped.x).toBe(CARD_WIDTH - 200);
      // Unknown height → origin can't go past the bottom edge minus a min margin.
      expect(clamped.y).toBeLessThan(CARD_HEIGHT);
      expect(clamped.y).toBeGreaterThan(CARD_HEIGHT - 40);
    });
  });

  describe("isOutsideSafeArea", () => {
    it("is false for a box comfortably inside the safe frame", () => {
      expect(
        isOutsideSafeArea({ x: 50, y: 50, width: 100, height: 100 }),
      ).toBe(false);
    });

    it("is true when the box runs past the bottom safe margin", () => {
      expect(
        isOutsideSafeArea({ x: 50, y: CARD_HEIGHT - CARD_SAFE_MARGIN, width: 100, height: 100 }),
      ).toBe(true);
    });

    it("is true when the box starts inside the top/left margin", () => {
      expect(isOutsideSafeArea({ x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    });
  });

  describe("textWrapWidth", () => {
    it("uses an explicit width when set", () => {
      expect(textWrapWidth({ x: 40, width: 220 })).toBe(220);
    });

    it("falls back to the distance to the card's right edge, less padding", () => {
      // 450 - 40 - 16 = 394
      expect(textWrapWidth({ x: 40 })).toBe(394);
    });

    it("never returns a width below the minimum, even near the right edge", () => {
      expect(textWrapWidth({ x: CARD_WIDTH })).toBe(40);
    });
  });
});
