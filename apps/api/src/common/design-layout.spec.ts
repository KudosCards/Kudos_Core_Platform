import {
  bakeScale,
  CARD_HEIGHT,
  CARD_SAFE_MARGIN,
  CARD_WIDTH,
  cardSnapLines,
  clampElementPosition,
  clampZoom,
  computeSnap,
  coverCrop,
  designElementSchema,
  designPageSchema,
  EDITOR_FONTS,
  isImageAssetSrc,
  isOutsideSafeArea,
  konvaFontStyle,
  konvaTextDecoration,
  MIN_ELEMENT_SIZE,
  MIN_FONT_SIZE,
  normaliseRotation,
  reorderElement,
  SNAP_THRESHOLD,
  steppedZoom,
  textWrapWidth,
  WEB_FONT_KEYS,
  ZOOM_MAX,
  ZOOM_MIN,
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
      expect(isOutsideSafeArea({ x: 50, y: 50, width: 100, height: 100 })).toBe(false);
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
      expect(lines.x).toEqual([
        0,
        CARD_SAFE_MARGIN,
        CARD_WIDTH / 2,
        CARD_WIDTH - CARD_SAFE_MARGIN,
        CARD_WIDTH,
      ]);
      expect(lines.y).toEqual([
        0,
        CARD_SAFE_MARGIN,
        CARD_HEIGHT / 2,
        CARD_HEIGHT - CARD_SAFE_MARGIN,
        CARD_HEIGHT,
      ]);
    });
  });

  describe("computeSnap", () => {
    const centreX = CARD_WIDTH / 2; // 225
    const centreY = CARD_HEIGHT / 2; // 317
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

  describe("reorderElement", () => {
    const ids = (els: { id: string }[]) => els.map((e) => e.id);
    const list = () => [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

    it("brings an element one step forward (toward the top of the stack)", () => {
      expect(ids(reorderElement(list(), "b", "forward"))).toEqual(["a", "c", "b", "d"]);
    });

    it("sends an element one step backward", () => {
      expect(ids(reorderElement(list(), "c", "backward"))).toEqual(["a", "c", "b", "d"]);
    });

    it("brings an element to the very front (end of the array)", () => {
      expect(ids(reorderElement(list(), "b", "front"))).toEqual(["a", "c", "d", "b"]);
    });

    it("sends an element to the very back (start of the array)", () => {
      expect(ids(reorderElement(list(), "c", "back"))).toEqual(["c", "a", "b", "d"]);
    });

    it("is a no-op moving the top element further forward", () => {
      expect(ids(reorderElement(list(), "d", "forward"))).toEqual(["a", "b", "c", "d"]);
    });

    it("is a no-op moving the bottom element further back", () => {
      expect(ids(reorderElement(list(), "a", "backward"))).toEqual(["a", "b", "c", "d"]);
    });

    it("returns the original array untouched when the id is missing", () => {
      const original = list();
      const result = reorderElement(original, "zzz", "front");
      expect(result).toBe(original);
    });

    it("does not mutate the input array", () => {
      const original = list();
      reorderElement(original, "a", "front");
      expect(ids(original)).toEqual(["a", "b", "c", "d"]);
    });
  });

  describe("konvaFontStyle", () => {
    it("maps the four bold/italic combinations to Konva's fontStyle", () => {
      expect(konvaFontStyle(false, false)).toBe("normal");
      expect(konvaFontStyle(true, false)).toBe("bold");
      expect(konvaFontStyle(false, true)).toBe("italic");
      expect(konvaFontStyle(true, true)).toBe("italic bold");
    });

    it("treats undefined toggles as off", () => {
      expect(konvaFontStyle()).toBe("normal");
      expect(konvaFontStyle(undefined, true)).toBe("italic");
    });
  });

  describe("konvaTextDecoration", () => {
    it("maps the underline toggle to Konva's textDecoration", () => {
      expect(konvaTextDecoration(true)).toBe("underline");
      expect(konvaTextDecoration(false)).toBe("");
      expect(konvaTextDecoration()).toBe("");
    });
  });

  describe("EDITOR_FONTS catalogue", () => {
    it("has unique keys", () => {
      const keys = EDITOR_FONTS.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("keeps the legacy system fonts so existing designs still resolve", () => {
      const keys = EDITOR_FONTS.map((f) => f.key);
      for (const legacy of ["Helvetica", "Georgia", "Times New Roman", "Courier New"]) {
        expect(keys).toContain(legacy);
      }
    });

    it("lists WEB_FONT_KEYS as exactly the web fonts", () => {
      expect(WEB_FONT_KEYS).toEqual(EDITOR_FONTS.filter((f) => f.webFont).map((f) => f.key));
      // System fonts are never in the web-load set.
      expect(WEB_FONT_KEYS).not.toContain("Helvetica");
    });
  });

  describe("designElementSchema text styling (additive/optional)", () => {
    const baseText = {
      kind: "text" as const,
      id: "t1",
      text: "Hi",
      x: 10,
      y: 10,
      fontFamily: "Montserrat",
      fontSize: 20,
      color: "#111111",
    };

    it("accepts bold/italic/underline toggles", () => {
      const parsed = designElementSchema.parse({
        ...baseText,
        bold: true,
        italic: true,
        underline: true,
      });
      expect(parsed).toMatchObject({ bold: true, italic: true, underline: true });
    });

    it("leaves the toggles undefined when omitted (existing designs unchanged)", () => {
      const parsed = designElementSchema.parse(baseText) as {
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
      };
      expect(parsed.bold).toBeUndefined();
      expect(parsed.italic).toBeUndefined();
      expect(parsed.underline).toBeUndefined();
    });
  });

  describe("coverCrop", () => {
    const box = { width: 450, height: 600 }; // the card face (portrait)

    it("crops the sides of a landscape image to fill a portrait box", () => {
      const crop = coverCrop({ width: 2000, height: 1000 }, box);
      expect(crop.height).toBe(1000); // full height kept
      expect(crop.width).toBeCloseTo(750); // 1000 * (450/600)
      expect(crop.x).toBeCloseTo((2000 - 750) / 2); // centred
      expect(crop.y).toBe(0);
    });

    it("crops the top and bottom of a very tall image", () => {
      const crop = coverCrop({ width: 450, height: 2000 }, box);
      expect(crop.width).toBe(450); // full width kept
      expect(crop.height).toBeCloseTo(600); // 450 / (450/600)
      expect(crop.y).toBeCloseTo((2000 - 600) / 2); // centred
      expect(crop.x).toBe(0);
    });

    it("returns the whole image when it already matches the box ratio", () => {
      const crop = coverCrop({ width: 900, height: 1200 }, box);
      expect(crop).toEqual({ x: 0, y: 0, width: 900, height: 1200 });
    });

    it("returns a zero rect for a degenerate image", () => {
      expect(coverCrop({ width: 0, height: 0 }, box)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
  });

  describe("designPageSchema background (additive/optional)", () => {
    const basePage = { name: "front" as const, elements: [] };

    it("accepts a page with no background (existing designs unchanged)", () => {
      const parsed = designPageSchema.parse(basePage);
      expect(parsed.background).toBeUndefined();
    });

    it("accepts a solid-colour background", () => {
      const parsed = designPageSchema.parse({
        ...basePage,
        background: { type: "color", color: "#ffeecc" },
      });
      expect(parsed.background).toEqual({ type: "color", color: "#ffeecc" });
    });

    it("accepts an image background", () => {
      const parsed = designPageSchema.parse({
        ...basePage,
        background: { type: "image", assetUrl: "https://cdn.example.com/bg.jpg" },
      });
      expect(parsed.background).toMatchObject({ type: "image" });
    });

    it("rejects an unknown background type", () => {
      expect(() =>
        designPageSchema.parse({ ...basePage, background: { type: "gradient" } }),
      ).toThrow();
    });
  });

  describe("designElementSchema shape (additive kind)", () => {
    const baseShape = {
      kind: "shape" as const,
      id: "s1",
      shape: "rect" as const,
      x: 10,
      y: 10,
      width: 100,
      height: 80,
    };

    it("accepts a minimal shape (styling all optional)", () => {
      const parsed = designElementSchema.parse(baseShape);
      expect(parsed.kind).toBe("shape");
      // rotation defaults to 0 like the other visual elements.
      expect((parsed as { rotation: number }).rotation).toBe(0);
    });

    it("accepts fill / stroke / strokeWidth / cornerRadius", () => {
      const parsed = designElementSchema.parse({
        ...baseShape,
        fill: "#93c5fd",
        stroke: "#111111",
        strokeWidth: 2,
        cornerRadius: 8,
      });
      expect(parsed).toMatchObject({ fill: "#93c5fd", stroke: "#111111", strokeWidth: 2 });
    });

    it("accepts every supported shape kind", () => {
      for (const shape of ["rect", "ellipse", "triangle", "star", "heart", "line"] as const) {
        expect(designElementSchema.parse({ ...baseShape, shape }).kind).toBe("shape");
      }
    });

    it("rejects an unknown shape kind and a negative stroke width", () => {
      expect(() => designElementSchema.parse({ ...baseShape, shape: "hexagon" })).toThrow();
      expect(() => designElementSchema.parse({ ...baseShape, strokeWidth: -1 })).toThrow();
    });
  });

  describe("isImageAssetSrc / image assetUrl", () => {
    it("accepts absolute http(s) URLs and root-relative paths", () => {
      expect(isImageAssetSrc("https://cdn.example.com/a.png")).toBe(true);
      expect(isImageAssetSrc("http://cdn.example.com/a.png")).toBe(true);
      expect(isImageAssetSrc("/stickers/cake.svg")).toBe(true);
    });

    it("rejects bare/relative or scheme-less values", () => {
      expect(isImageAssetSrc("stickers/cake.svg")).toBe(false);
      expect(isImageAssetSrc("cake.svg")).toBe(false);
      expect(isImageAssetSrc("")).toBe(false);
    });

    const baseImage = {
      kind: "image" as const,
      id: "i1",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };

    it("lets an image element use a sticker's root-relative path", () => {
      const parsed = designElementSchema.parse({
        ...baseImage,
        assetUrl: "/stickers/balloon.svg",
      });
      expect(parsed).toMatchObject({ kind: "image", assetUrl: "/stickers/balloon.svg" });
    });

    it("still accepts an uploaded absolute URL, and rejects a bare path", () => {
      expect(() =>
        designElementSchema.parse({ ...baseImage, assetUrl: "https://cdn.example.com/x.png" }),
      ).not.toThrow();
      expect(() => designElementSchema.parse({ ...baseImage, assetUrl: "not-a-url" })).toThrow();
    });
  });

  describe("zoom (clampZoom / steppedZoom)", () => {
    it("clamps to the allowed range", () => {
      expect(clampZoom(10)).toBe(ZOOM_MAX);
      expect(clampZoom(0.1)).toBe(ZOOM_MIN);
      expect(clampZoom(1.25)).toBe(1.25);
    });

    it("steps up and down on a clean grid", () => {
      expect(steppedZoom(1, 1)).toBe(1.25);
      expect(steppedZoom(1, -1)).toBe(0.75);
      // Snaps an off-grid value to the grid, then steps.
      expect(steppedZoom(1.1, 1)).toBe(1.25);
      expect(steppedZoom(1.1, -1)).toBe(0.75);
    });

    it("never steps past the bounds", () => {
      expect(steppedZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
      expect(steppedZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    });
  });
});
