import {
  backgroundPrintedSizeMm,
  collectPrintImageTargets,
  effectivePrintDpi,
  elementPrintedSizeMm,
  imagePrintDpi,
  isLowPrintDpi,
  printDpiVerdict,
  PRINT_DPI_TARGET,
  type DesignDocument,
} from "@kudos/shared-types";

describe("effectivePrintDpi", () => {
  it("computes pixels-per-inch from source pixels and printed mm", () => {
    expect(effectivePrintDpi(300, 25.4)).toBeCloseTo(300, 5); // 300px across 1 inch
    expect(effectivePrintDpi(300, 12.7)).toBeCloseTo(600, 5); // same px, half an inch
  });

  it("returns 0 for degenerate input", () => {
    expect(effectivePrintDpi(0, 25.4)).toBe(0);
    expect(effectivePrintDpi(300, 0)).toBe(0);
  });
});

describe("imagePrintDpi", () => {
  it("reports the limiting (lower) axis", () => {
    expect(imagePrintDpi({ width: 600, height: 100 }, { widthMm: 25.4, heightMm: 25.4 })).toBeCloseTo(100, 5);
  });
});

describe("printDpiVerdict / isLowPrintDpi", () => {
  it("buckets ok / acceptable / low", () => {
    expect(printDpiVerdict(320)).toBe("ok");
    expect(printDpiVerdict(PRINT_DPI_TARGET)).toBe("ok");
    expect(printDpiVerdict(250)).toBe("acceptable");
    expect(printDpiVerdict(150)).toBe("low");
    expect(isLowPrintDpi(150)).toBe(true);
    expect(isLowPrintDpi(250)).toBe(false);
  });
});

describe("printed sizes", () => {
  it("scales an element's design-unit box to mm at A6 (design fills trim width)", () => {
    const printed = elementPrintedSizeMm({ width: 225, height: 100 }, "A6");
    expect(printed.widthMm).toBeCloseTo((225 * 105) / 450, 4);
    expect(printed.heightMm).toBeCloseTo((100 * 105) / 450, 4);
  });

  it("uses the full trim for a background", () => {
    expect(backgroundPrintedSizeMm("A6")).toEqual({ widthMm: 105, heightMm: 148 });
    expect(backgroundPrintedSizeMm("A5")).toEqual({ widthMm: 148, heightMm: 210 });
  });

  it("flags a small photo blown up across a card as low-res", () => {
    const printed = elementPrintedSizeMm({ width: 320, height: 220 }, "A6");
    expect(isLowPrintDpi(imagePrintDpi({ width: 300, height: 200 }, printed))).toBe(true);
  });
});

describe("collectPrintImageTargets", () => {
  const document: DesignDocument = {
    version: 1,
    pages: [
      {
        name: "front",
        background: { type: "image", assetUrl: "https://x/bg.jpg" },
        elements: [
          { kind: "image", id: "a", assetUrl: "https://x/photo.png", x: 10, y: 10, width: 200, height: 150, rotation: 0 },
          { kind: "image", id: "b", assetUrl: "/stickers/star.svg", x: 10, y: 10, width: 60, height: 60, rotation: 0 },
          { kind: "text", id: "t", text: "hi", x: 0, y: 0, fontFamily: "Montserrat", fontSize: 20, color: "#000" },
        ],
      },
      { name: "back", elements: [] },
    ],
  };

  it("collects raster backgrounds + image elements with their printed sizes, skipping SVG + non-images", () => {
    const targets = collectPrintImageTargets(document, "A6");
    expect(targets).toHaveLength(2); // bg + png photo; SVG sticker and text excluded
    expect(targets.find((t) => t.where === "background")?.printed).toEqual({ widthMm: 105, heightMm: 148 });
    const photo = targets.find((t) => t.assetUrl === "https://x/photo.png");
    expect(photo?.printed.widthMm).toBeCloseTo((200 * 105) / 450, 4);
  });
});
