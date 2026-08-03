import {
  bakeScale,
  CARD_HEIGHT,
  CARD_SAFE_MARGIN,
  CARD_WIDTH,
  clampElementPosition,
  designElementSchema,
  isOutsideSafeArea,
  MIN_ELEMENT_SIZE,
  MIN_FONT_SIZE,
  normaliseRotation,
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

  describe("bakeScale", () => {
    it("folds a scale factor into a dimension and rounds", () => {
      // A 100px box dragged to 1.5× → 150.
      expect(bakeScale(100, 1.5)).toBe(150);
      // Rounds to the nearest whole design unit.
      expect(bakeScale(20, 1.234)).toBe(25);
    });

    it("floors at the default minimum so a handle-drag can't shrink to nothing", () => {
      expect(bakeScale(20, 0.01)).toBe(MIN_ELEMENT_SIZE);
    });

    it("honours a custom minimum (e.g. font size)", () => {
      expect(bakeScale(10, 0.1, MIN_FONT_SIZE)).toBe(MIN_FONT_SIZE);
      // Above the floor it scales normally.
      expect(bakeScale(20, 0.5, MIN_FONT_SIZE)).toBe(10);
    });
  });

  describe("normaliseRotation", () => {
    it("leaves an in-range angle unchanged", () => {
      expect(normaliseRotation(0)).toBe(0);
      expect(normaliseRotation(45)).toBe(45);
      expect(normaliseRotation(359)).toBe(359);
    });

    it("wraps angles at or beyond a full turn back into [0, 360)", () => {
      expect(normaliseRotation(360)).toBe(0);
      expect(normaliseRotation(450)).toBe(90);
    });

    it("wraps negative angles up into range", () => {
      expect(normaliseRotation(-90)).toBe(270);
      expect(normaliseRotation(-360)).toBe(0);
    });
  });

  describe("designElementSchema text rotation (additive/optional)", () => {
    const baseText = {
      kind: "text" as const,
      id: "t1",
      text: "Hi",
      x: 10,
      y: 10,
      fontFamily: "Helvetica",
      fontSize: 20,
      color: "#111111",
    };

    it("accepts a text element without a rotation (existing designs unchanged)", () => {
      const parsed = designElementSchema.parse(baseText);
      expect(parsed.kind).toBe("text");
      // Optional, so it stays undefined rather than being forced to a default.
      expect((parsed as { rotation?: number }).rotation).toBeUndefined();
    });

    it("accepts a text element with a rotation", () => {
      const parsed = designElementSchema.parse({ ...baseText, rotation: 15 });
      expect((parsed as { rotation?: number }).rotation).toBe(15);
    });
  });
});
