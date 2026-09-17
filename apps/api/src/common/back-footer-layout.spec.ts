import {
  CARD_HEIGHT,
  CARD_SIZES,
  CARD_WIDTH,
  backFooterLayout,
  backReservedFooterTop,
} from "@kudos/shared-types";

/**
 * The strip across the bottom of the card back, when we print it ourselves
 * rather than buying stock with it already on. See
 * docs/card-print-quality-plan.md (P4) and ADR 0249.
 */
describe("backFooterLayout", () => {
  it.each(CARD_SIZES)("covers exactly the reserved strip on %s", (size) => {
    const { band } = backFooterLayout(size, true);
    // The band and the rule that keeps customer artwork out of it have to be
    // the same strip, or a card prints with a seam between them.
    expect(band).toEqual({
      x: 0,
      y: backReservedFooterTop(size),
      width: CARD_WIDTH,
      height: CARD_HEIGHT - backReservedFooterTop(size),
    });
  });

  it("gives a card with no message page a band and the mark, nothing else", () => {
    // The point of the whole option: no fake QR, and no caption telling the
    // recipient to scan something that isn't there.
    const layout = backFooterLayout("A6", false);
    expect(layout.qr).toBeNull();
    expect(layout.caption).toBeNull();
    expect(layout.logo.width).toBeGreaterThan(0);
  });

  it("centres the mark when it is alone on the strip", () => {
    const { logo } = backFooterLayout("A6", false);
    const leftGap = logo.x;
    const rightGap = CARD_WIDTH - (logo.x + logo.width);
    expect(leftGap).toBeCloseTo(rightGap, 6);
  });

  it("lays the strip out left to right: QR, caption, mark", () => {
    const { qr, caption, logo } = backFooterLayout("A6", true);
    expect(qr).not.toBeNull();
    expect(caption).not.toBeNull();
    expect(qr!.x + qr!.width).toBeLessThanOrEqual(caption!.x);
    expect(caption!.x + caption!.width).toBeLessThanOrEqual(logo.x);
  });

  it.each(CARD_SIZES)("keeps every piece inside the band on %s", (size) => {
    const { band, qr, caption, logo } = backFooterLayout(size, true);
    const bandBottom = band.y + band.height;

    for (const box of [qr!, caption!, logo]) {
      expect(box.x).toBeGreaterThanOrEqual(band.x);
      expect(box.x + box.width).toBeLessThanOrEqual(band.x + band.width);
      expect(box.y).toBeGreaterThanOrEqual(band.y);
      expect(box.y + box.height).toBeLessThanOrEqual(bandBottom);
    }
  });

  it("keeps the QR square — a stretched one will not scan", () => {
    const { qr } = backFooterLayout("A6", true);
    expect(qr!.width).toBe(qr!.height);
  });

  it("gives the QR enough of the strip to be scannable", () => {
    // 30mm of band, so the QR should be most of it rather than a token square:
    // at A6 the band is 128.5 design units ≈ 30mm and the QR should clear 20mm.
    const { qr } = backFooterLayout("A6", true);
    const unitsToMm = 105 / CARD_WIDTH;
    expect(qr!.width * unitsToMm).toBeGreaterThan(20);
  });

  it("holds the mark's proportions rather than stretching it", () => {
    const { logo } = backFooterLayout("A6", true);
    expect(logo.width / logo.height).toBeCloseTo(410 / 475, 6);
  });
});
