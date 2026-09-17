import { inflateSync } from "zlib";
import { PT_PER_MM } from "./geometry";
import { foldedSheetGeometry } from "./geometry";
import { renderFoldedRunPdf } from "./render";
import sharp from "sharp";
import { backFooterLayout, backReservedFooterTop } from "@kudos/shared-types";
import type { DesignDocument, DesignPage } from "@kudos/shared-types";

/**
 * The sheet the printer actually takes: two faces to a landscape page, fold down
 * the middle, one sheet per side. See docs/card-print-quality-plan.md (P4) and
 * ADR 0249.
 *
 * These read the PDF's own drawing operators rather than checking that the file
 * parses. Where a panel lands and which face goes on it is the entire change —
 * a smoke test would pass with the two panels swapped, which is a card with the
 * front cover printed on its back.
 */

/** Inflate every FlateDecode stream in a PDF and return them as text. */
function contentStreams(pdf: Buffer): string[] {
  const raw = pdf.toString("latin1");
  const out: string[] = [];
  const marker = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out.push(inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1"));
    } catch {
      // Not a compressed content stream (embedded font subset, metadata) — skip.
    }
  }
  return out;
}

/** One entry per page, in page order — the streams carrying drawing operators
 * (the others are embedded font subsets). */
function pageStreams(pdf: Buffer): string[] {
  const streams = contentStreams(pdf).filter((s) => / scn\b/.test(s) && / re\b/.test(s));
  if (streams.length === 0) throw new Error("no drawing streams found in PDF");
  return streams;
}

/** The non-white `r g b scn` fills in a stream, in order. The white base every
 * panel starts with is dropped, leaving one entry per face background. */
function backgroundFills(stream: string): string[] {
  const re = /([\d.]+) ([\d.]+) ([\d.]+) scn/g;
  const fills: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) {
    const rgb = `${m[1]} ${m[2]} ${m[3]}`;
    if (rgb !== "1 1 1") fills.push(rgb);
  }
  return fills;
}

/** Every `x y w h re` rectangle in a stream, in order (clipped or filled). */
function rects(stream: string): { x: number; y: number; w: number; h: number }[] {
  const re = /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re\b/g;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) {
    out.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) });
  }
  return out;
}

/** Every `a b c d e f cm` transform in a stream, in order. */
function transforms(stream: string): number[][] {
  const re = /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) cm/g;
  const out: number[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream))) out.push(m.slice(1).map(Number));
  return out;
}

/** The media boxes declared in the PDF, in file order. */
function mediaBoxes(pdf: Buffer): number[][] {
  const re = /\/MediaBox \[([^\]]+)\]/g;
  const raw = pdf.toString("latin1");
  const out: number[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[1]!.trim().split(/\s+/).map(Number));
  return out;
}

/** A card whose four faces are four flat, unmistakable colours, so the stream
 * says which face landed on which panel. */
const FACE_COLOUR: Record<string, { hex: string; rgb: string }> = {
  front: { hex: "#ff0000", rgb: "1 0 0" },
  back: { hex: "#00ff00", rgb: "0 1 0" },
  "inside-left": { hex: "#0000ff", rgb: "0 0 1" },
  "inside-right": { hex: "#00ffff", rgb: "0 1 1" },
};

function colourCard(faces: DesignPage["name"][]): DesignDocument {
  return {
    version: 1,
    pages: faces.map((name) => ({
      name,
      background: { type: "color" as const, color: FACE_COLOUR[name]!.hex },
      elements: [],
    })),
  };
}

const ALL_FACES: DesignPage["name"][] = ["front", "inside-left", "inside-right", "back"];

describe("foldedSheetGeometry", () => {
  it("is the A5 landscape sheet an A6 card folds from", () => {
    const sheet = foldedSheetGeometry("A6");
    expect(sheet.pageWidthPt / PT_PER_MM).toBeCloseTo(210, 6);
    expect(sheet.pageHeightPt / PT_PER_MM).toBeCloseTo(148, 6);
  });

  it("tiles the sheet exactly with two panels, so the fold is their shared edge", () => {
    // Any gap here prints as a white stripe down the middle of a folded card.
    const sheet = foldedSheetGeometry("A6");
    expect(sheet.panelXPt[0]).toBe(0);
    expect(sheet.panelXPt[1]).toBeCloseTo(sheet.panel.pageWidthPt, 9);
    expect(sheet.panelXPt[1] + sheet.panel.pageWidthPt).toBeCloseTo(sheet.pageWidthPt, 9);
    expect(sheet.foldXPt).toBeCloseTo(sheet.pageWidthPt / 2, 9);
  });

  it("gives the panel no bleed and no margin — there is nothing to trim", () => {
    expect(foldedSheetGeometry("A6").panel.bleedPt).toBe(0);
  });

  it("draws full size until an overhang has been measured", () => {
    expect(foldedSheetGeometry("A6").shrink).toBe(1);
    expect(foldedSheetGeometry("A6", 0).shrink).toBe(1);
  });

  it("compensates a measured overhang", () => {
    expect(foldedSheetGeometry("A6", 3).shrink).toBeCloseTo(210 / 216, 9);
  });
});

describe("renderFoldedRunPdf", () => {
  it("emits two sheets per card — one outside, one inside", async () => {
    const pdf = await renderFoldedRunPdf([
      { document: colourCard(ALL_FACES) },
      { document: colourCard(ALL_FACES) },
    ]);
    expect(pageStreams(pdf)).toHaveLength(4);
  });

  it("makes every page the landscape sheet, not a card face", async () => {
    const pdf = await renderFoldedRunPdf([{ document: colourCard(ALL_FACES) }]);
    for (const box of mediaBoxes(pdf)) {
      expect(box[2]! / PT_PER_MM).toBeCloseTo(210, 3);
      expect(box[3]! / PT_PER_MM).toBeCloseTo(148, 3);
    }
  });

  it("puts the back and front on the outside, in that order", async () => {
    // Folding the left half behind the right leaves the right half facing out,
    // so the front cover must be the right-hand panel. Swap these and every card
    // posts with its cover on the back.
    const pdf = await renderFoldedRunPdf([{ document: colourCard(ALL_FACES) }]);
    expect(backgroundFills(pageStreams(pdf)[0]!)).toEqual([
      FACE_COLOUR.back!.rgb,
      FACE_COLOUR.front!.rgb,
    ]);
  });

  it("puts the insides on the second sheet, left then right", async () => {
    // Manual duplex turns the stack about the short edge, mirroring it, so the
    // panel printed on the right of side one becomes the left of side two —
    // which is the panel the card opens onto.
    const pdf = await renderFoldedRunPdf([{ document: colourCard(ALL_FACES) }]);
    expect(backgroundFills(pageStreams(pdf)[1]!)).toEqual([
      FACE_COLOUR["inside-left"]!.rgb,
      FACE_COLOUR["inside-right"]!.rgb,
    ]);
  });

  it("interleaves cards so every outside is an odd page", async () => {
    // What manual duplex wants: print the odd pages, turn the stack, print the
    // even ones. Grouping all the outsides first would need a second pass.
    const pdf = await renderFoldedRunPdf([
      { document: colourCard(ALL_FACES) },
      { document: colourCard(ALL_FACES) },
    ]);
    const pages = pageStreams(pdf).map(backgroundFills);
    expect(pages[0]).toEqual(pages[2]);
    expect(pages[1]).toEqual(pages[3]);
    expect(pages[0]![1]).toBe(FACE_COLOUR.front!.rgb);
  });

  it("offsets the right-hand panel by exactly one panel width", async () => {
    const sheet = foldedSheetGeometry("A6");
    const pdf = await renderFoldedRunPdf([{ document: colourCard(ALL_FACES) }]);
    const translates = transforms(pageStreams(pdf)[0]!).filter(
      (t) => t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1,
    );
    const xs = translates.map((t) => t[4]!);
    expect(xs.some((x) => Math.abs(x - sheet.panel.pageWidthPt) < 0.01)).toBe(true);
  });

  it("leaves a face the design does not carry blank, never the front", async () => {
    // The single-face renderer falls back to the front for a missing face. On a
    // real sheet that would print the cover artwork on the back of the card.
    const pdf = await renderFoldedRunPdf([{ document: colourCard(["front"]) }]);
    const pages = pageStreams(pdf).map(backgroundFills);
    expect(pages[0]).toEqual([FACE_COLOUR.front!.rgb]);
    expect(pages[1]).toEqual([]);
  });

  it("refuses an empty run rather than writing a page-less PDF", async () => {
    await expect(renderFoldedRunPdf([])).rejects.toThrow(/no cards/);
  });
});

describe("borderless compensation", () => {
  /** The uniform `s 0 0 s 0 0 cm` scales in a stream. */
  function uniformScales(stream: string): number[] {
    return transforms(stream)
      .filter((t) => t[1] === 0 && t[2] === 0 && t[0] === t[3] && t[4] === 0 && t[5] === 0)
      .map((t) => t[0]!);
  }

  /** The design-unit scale each panel applies (450 units across 105 mm). */
  const PANEL_SCALE = foldedSheetGeometry("A6").panel.scalePtPerUnit;

  it("draws the sheet untouched when nothing has been measured", async () => {
    const pdf = await renderFoldedRunPdf([{ document: colourCard(ALL_FACES) }], {
      borderlessOverhangMm: 0,
    });
    // Exactly one scale per panel — its own design scale — and nothing else.
    // An unconditional shrink would leave a white margin on every card.
    const scales = uniformScales(pageStreams(pdf)[0]!);
    expect(scales).toHaveLength(2);
    for (const scale of scales) expect(scale).toBeCloseTo(PANEL_SCALE, 4);

    // And the sheet is not moved about at all: compensating "by zero" would
    // still emit the shift out to the centre and back, which is the one place a
    // rounding error could creep into a page that needs none.
    const outward = transforms(pageStreams(pdf)[0]!).filter((t) => t[4]! < 0 || t[5]! < 0);
    expect(outward).toEqual([]);
  });

  it("scales the sheet by the inverse of the driver's enlargement", async () => {
    const pdf = await renderFoldedRunPdf([{ document: colourCard(ALL_FACES) }], {
      borderlessOverhangMm: 3,
    });
    const scales = uniformScales(pageStreams(pdf)[0]!);
    // The two panel scales, plus one sheet-level shrink applied before them.
    expect(scales).toHaveLength(3);
    expect(scales.filter((s) => Math.abs(s - 210 / 216) < 1e-4)).toHaveLength(1);

    // Scaled about the sheet centre, not the origin — the giveaway is the
    // translate back out again. Scaling about the origin would pull the card
    // into one corner: the far edge losing twice the overhang, the near one none.
    const sheet = foldedSheetGeometry("A6");
    const back = transforms(pageStreams(pdf)[0]!).filter(
      (t) => Math.abs(t[4]! + sheet.pageWidthPt / 2) < 0.01,
    );
    expect(back).toHaveLength(1);
  });

  it("shrinks about the sheet centre, so both edges lose the same", () => {
    // Scaling about the origin would pull the card into one corner: the far
    // edge would lose twice the overhang and the near edge none.
    const sheet = foldedSheetGeometry("A6", 3);
    const insetLeft = (sheet.pageWidthPt * (1 - sheet.shrink)) / 2;
    const insetRight = sheet.pageWidthPt - (insetLeft + sheet.pageWidthPt * sheet.shrink);
    expect(insetRight).toBeCloseTo(insetLeft, 9);
    // And that inset, enlarged by the driver, is exactly the 3 mm it throws away.
    expect((insetLeft / PT_PER_MM) * (216 / 210)).toBeCloseTo(3, 6);
  });
});

/**
 * A card back carries a QR only if the customer chose a message page. What goes
 * in its place is the difference between a card that looks finished and one that
 * looks misprinted.
 */
describe("the QR on a card with no message page", () => {
  const qrCard: DesignDocument = {
    version: 1,
    pages: [
      { name: "front", elements: [] },
      {
        name: "back",
        elements: [{ kind: "qr", id: "q", x: 100, y: 100, size: 120, rotation: 0 }],
      },
    ],
  };

  /** Nothing else on these cards strokes, so a stroke is the placeholder's
   * outline and only that. */
  const strokes = (stream: string): number => (stream.match(/\bS\b/g) ?? []).length;

  it("draws nothing at all on a folded sheet", async () => {
    // These pages get posted. A grey square with a border, on a finished card,
    // reads to the recipient as a printing fault — and to anyone who scans it,
    // as nothing.
    const pdf = await renderFoldedRunPdf([{ document: qrCard }]);
    expect(strokes(pageStreams(pdf)[0]!)).toBe(0);
  });

  it("still draws the editor's placeholder when a caller asks for one", async () => {
    // The contrast that proves the test above is measuring the option and not
    // some other reason the outline is missing.
    const pdf = await renderFoldedRunPdf([{ document: qrCard }], { qrPlaceholder: true });
    expect(strokes(pageStreams(pdf)[0]!)).toBeGreaterThan(0);
  });
});

/**
 * The strip across the bottom of the back, drawn here rather than bought
 * pre-printed on the stock.
 */
describe("the printed back footer", () => {
  const plainCard: DesignDocument = {
    version: 1,
    pages: [
      { name: "front", elements: [] },
      { name: "back", background: { type: "color", color: "#00ff00" }, elements: [] },
    ],
  };

  /** A real PNG, so pdfkit embeds the mark rather than refusing the bytes. */
  async function logoResolver(): Promise<
    (url: string) => Promise<{ data: Buffer; width: number; height: number } | null>
  > {
    const data = await sharp({
      create: { width: 41, height: 47, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    return () => Promise.resolve({ data, width: 41, height: 47 });
  }

  /** How many rectangles the stream draws — a real QR is hundreds of modules,
   * an empty band is a handful of page fills and clips. */
  const rectCount = (stream: string): number => rects(stream).length;

  it("leaves the strip alone by default, because the stock already carries it", async () => {
    // Switching this on against pre-printed stock overprints the branding, so
    // "reserved" has to be what a caller gets without asking.
    const pdf = await renderFoldedRunPdf([{ document: plainCard }]);
    expect(pageStreams(pdf)[0]!).not.toMatch(/\bBT\b/);
  });

  it("paints the band over the full strip, so no artwork shows beneath it", async () => {
    const sheet = foldedSheetGeometry("A6");
    const reservedFromPt =
      sheet.panel.translateYPt + backReservedFooterTop("A6") * sheet.panel.scalePtPerUnit;
    const bandHeightPt = sheet.panel.pageHeightPt - reservedFromPt;

    const pdf = await renderFoldedRunPdf([{ document: plainCard }], { backFooter: "print" });
    const band = rects(pageStreams(pdf)[0]!).find(
      (r) => Math.abs(r.y - reservedFromPt) < 0.01 && Math.abs(r.h - bandHeightPt) < 0.01,
    );

    expect(band).toBeDefined();
    // Full panel width: a band drawn to the *design* box would leave a sliver of
    // the customer's background showing down the side on A5.
    expect(band!.x).toBe(0);
    expect(band!.w).toBeCloseTo(sheet.panel.pageWidthPt, 6);
  });

  it("draws this card's QR and the caption when there is a message page", async () => {
    const pdf = await renderFoldedRunPdf([{ document: plainCard, qrUrl: "https://k.co/r/abc" }], {
      backFooter: "print",
    });
    const stream = pageStreams(pdf)[0]!;
    // Hundreds of modules: a real, scannable code rather than a stand-in.
    expect(rectCount(stream)).toBeGreaterThan(100);
    // The card carries no text of its own, so this is the caption.
    expect(stream).toMatch(/\bBT\b/);
  });

  it("gives a card with no message page a plain band and no words", async () => {
    // The whole reason this mode exists: "Scan to see your message" beside a
    // grey square is an instruction the recipient cannot follow.
    const pdf = await renderFoldedRunPdf([{ document: plainCard }], { backFooter: "print" });
    const stream = pageStreams(pdf)[0]!;
    expect(rectCount(stream)).toBeLessThan(30);
    expect(stream).not.toMatch(/\bBT\b/);
  });

  it("places the mark on the strip when one is supplied", async () => {
    const pdf = await renderFoldedRunPdf([{ document: plainCard }], {
      backFooter: "print",
      logoUrl: "https://app.example.com/marketing/logo.png",
      imageResolver: await logoResolver(),
    });
    // An image XObject reached the page.
    expect(pageStreams(pdf)[0]!).toMatch(/\/I\d+ Do/);
  });

  it("places the QR exactly where the shared layout puts it", async () => {
    // The renderer and the pre-send guide have to agree about the strip, or the
    // editor shows a customer one thing and the printer does another. The layout
    // spec proves the boxes sit inside the band; this proves the engine uses them.
    const { qr } = backFooterLayout("A6", true);
    const pdf = await renderFoldedRunPdf([{ document: plainCard, qrUrl: "https://k.co/r/abc" }], {
      backFooter: "print",
    });

    const translates = transforms(pageStreams(pdf)[0]!).filter(
      (t) => t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1,
    );
    const placed = translates.some(
      (t) => Math.abs(t[4]! - qr!.x) < 0.001 && Math.abs(t[5]! - qr!.y) < 0.001,
    );
    expect(placed).toBe(true);
  });
});
