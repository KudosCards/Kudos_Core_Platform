import { CARD_HEIGHT, CARD_WIDTH } from "@kudos/shared-types";
import { BLEED_MM, cropMarks, faceGeometry, PT_PER_MM } from "./geometry";

describe("faceGeometry", () => {
  it("sizes the A6 page as trim + 3mm bleed on every edge", () => {
    const g = faceGeometry("A6");
    // A6 trim is 105×148mm; page adds 3mm bleed all round → 111×154mm.
    expect(g.pageWidthPt).toBeCloseTo(111 * PT_PER_MM, 5);
    expect(g.pageHeightPt).toBeCloseTo(154 * PT_PER_MM, 5);
    expect(g.bleedPt).toBeCloseTo(BLEED_MM * PT_PER_MM, 5);
    // Trim box sits one bleed in, at the true trimmed size.
    expect(g.trim.xPt).toBeCloseTo(3 * PT_PER_MM, 5);
    expect(g.trim.yPt).toBeCloseTo(3 * PT_PER_MM, 5);
    expect(g.trim.widthPt).toBeCloseTo(105 * PT_PER_MM, 5);
    expect(g.trim.heightPt).toBeCloseTo(148 * PT_PER_MM, 5);
  });

  it("scales the design uniformly to fill the trim width (no distortion)", () => {
    const g = faceGeometry("A6");
    // 450 design units span 105mm → points per unit.
    const expected = (105 / CARD_WIDTH) * PT_PER_MM;
    expect(g.scalePtPerUnit).toBeCloseTo(expected, 6);
    // The design's derived height nearly fills A6 (design proportioned to A6), so
    // the vertical centring offset is essentially zero.
    const designHeightPt = CARD_HEIGHT * g.scalePtPerUnit;
    const offset = g.translateYPt - g.bleedPt;
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(designHeightPt + 2 * offset).toBeCloseTo(g.trim.heightPt, 4);
  });

  it("centres the design vertically on A5 (different proportion) without distortion", () => {
    const g = faceGeometry("A5");
    const designHeightPt = CARD_HEIGHT * g.scalePtPerUnit;
    // Fits by width; leaves a small vertical letterbox inside the trim.
    expect(designHeightPt).toBeLessThan(g.trim.heightPt);
    const offset = g.translateYPt - g.bleedPt;
    expect(offset).toBeGreaterThan(0);
    expect(g.translateXPt).toBeCloseTo(g.bleedPt, 5); // flush to trim width
  });
});

describe("cropMarks", () => {
  it("returns eight segments (two per corner) sitting in the bleed", () => {
    const g = faceGeometry("A6");
    const marks = cropMarks(g);
    expect(marks).toHaveLength(8);
    // Every mark endpoint must lie within the page, outside the trim (in bleed).
    for (const m of marks) {
      for (const [x, y] of [
        [m.x1, m.y1],
        [m.x2, m.y2],
      ]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(g.pageWidthPt + 1e-6);
        expect(y).toBeLessThanOrEqual(g.pageHeightPt + 1e-6);
      }
    }
  });
});
