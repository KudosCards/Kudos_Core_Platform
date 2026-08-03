import {
  bakeScale,
  CARD_HEIGHT,
  CARD_SAFE_MARGIN,
  CARD_WIDTH,
  cardSnapLines,
  clampElementPosition,
  computeSnap,
  designElementSchema,
  isOutsideSafeArea,
  MIN_ELEMENT_SIZE,
  MIN_FONT_SIZE,
  normaliseRotation,
  SNAP_THRESHOLD,
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

  describe("cardSnapLines", () => {
    it("exposes edges, safe margins, and centre on each axis", () => {
      const lines = cardSnapLines();
      expect(lines.x).toEqual([0, CARD_SAFE_MARGIN, CARD_WIDTH / 2, CARD_WIDTH - CARD_SAFE_MARGIN, CARD_WIDTH]);
      expect(lines.y).toEqual([0, CARD_SAFE_MARGIN, CARD_HEIGHT / 2, CARD_HEIGHT - CARD_SAFE_MARGIN, CARD_HEIGHT]);
    });
  });

  describe("computeSnap", () => {
    const centreX = CARD_WIDTH / 2; // 225
    const centreY = CARD_HEIGHT / 2; // 300
    const targets = cardSnapLines();

    it("snaps a box's centre to the card centre when within threshold", () => {
      // A 100×100 box whose centre sits 3px left of the card centre → snaps so
      // its centre lands exactly on 225/300, and reports both guide lines.
      const box = { x: centreX - 50 - 3, y: centreY - 50 - 3, width: 100, height: 100 };
      const result = computeSnap(box, targets);
      expect(result.x + box.width / 2).toBe(centreX);
      expect(result.y + box.height / 2).toBe(centreY);
      expect(result.guides).toEqual(
        expect.arrayContaining([
          { axis: "x", position: centreX },
          { axis: "y", position: centreY },
        ]),
      );
    });

    it("leaves a box alone and draws no guides when nothing is within threshold", () => {
      const box = { x: 100, y: 130, width: 40, height: 40 };
      const result = computeSnap(box, { x: [0], y: [0] });
      expect(result).toEqual({ x: 100, y: 130, guides: [] });
    });

    it("snaps the left edge flush to the safe margin", () => {
      const box = { x: CARD_SAFE_MARGIN + 4, y: 300, width: 50, height: 50 };
      const result = computeSnap(box, targets);
      expect(result.x).toBe(CARD_SAFE_MARGIN);
      expect(result.guides).toContainEqual({ axis: "x", position: CARD_SAFE_MARGIN });
    });

    it("picks the nearest of several candidate lines on an axis", () => {
      // A wide box so only its left edge (22) is near the candidates; the two
      // lines sit 4px (18) and 2px (24) away → snaps to the closer, 24.
      const box = { x: 22, y: 0, width: 60, height: 10 };
      const result = computeSnap(box, { x: [18, 24], y: [] }, SNAP_THRESHOLD);
      expect(result.x).toBe(24);
    });

    it("does not snap when just outside the threshold", () => {
      const box = { x: 100 + SNAP_THRESHOLD + 1, y: 0, width: 10, height: 10 };
      const result = computeSnap(box, { x: [100], y: [] });
      expect(result.x).toBe(box.x);
      expect(result.guides).toEqual([]);
    });
  });
});
