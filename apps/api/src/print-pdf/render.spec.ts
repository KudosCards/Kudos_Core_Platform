import { inflateSync } from "zlib";
import {
  BACK_RESERVED_FOOTER_MM,
  CARD_HEIGHT,
  CARD_SIZES,
  CARD_SIZE_DIMENSIONS_MM,
  CARD_WIDTH,
  type DesignDocument,
} from "@kudos/shared-types";
import { renderRunPdf } from "./render";

/** A document exercising every element kind + a colour background. */
const document: DesignDocument = {
  version: 1,
  pages: [
    {
      name: "front",
      background: { type: "color", color: "#faf5ff" },
      elements: [
        {
          kind: "text",
          id: "t",
          text: "Happy Birthday, Sam!",
          x: 30,
          y: 60,
          width: 380,
          align: "center",
          fontFamily: "Playfair Display",
          fontSize: 32,
          color: "#4c1d95",
          bold: true,
        },
        {
          kind: "shape",
          id: "s",
          shape: "heart",
          x: 200,
          y: 200,
          width: 50,
          height: 50,
          fill: "#ef4444",
          rotation: 0,
        },
        { kind: "qr", id: "q", x: 320, y: 500, size: 90, rotation: 0 },
        // An image element with no resolver supplied — must be skipped, not throw.
        {
          kind: "image",
          id: "i",
          assetUrl: "https://example.com/a.png",
          x: 20,
          y: 300,
          width: 120,
          height: 120,
          rotation: 0,
        },
      ],
    },
    {
      name: "inside-right",
      elements: [
        {
          kind: "text",
          id: "t2",
          text: "With love",
          x: 40,
          y: 300,
          fontFamily: "Lora",
          fontSize: 20,
          color: "#111111",
          italic: true,
        },
      ],
    },
  ],
};

function pdfPageCount(pdf: Buffer): number {
  const match = pdf.toString("latin1").match(/\/Count (\d+)/);
  return match ? Number(match[1]) : 0;
}

describe("renderRunPdf", () => {
  it("produces a valid PDF for a single face", async () => {
    const pdf = await renderRunPdf([
      { document, face: "front", qrUrl: "https://kudoscards.co.uk/r/demo" },
    ]);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdfPageCount(pdf)).toBe(1);
  });

  it("emits one page per face in a run", async () => {
    const pdf = await renderRunPdf([
      { document, face: "front", qrUrl: "https://kudoscards.co.uk/r/demo" },
      { document, face: "inside-right" },
    ]);
    expect(pdfPageCount(pdf)).toBe(2);
  });

  it("renders at A5 without error", async () => {
    const pdf = await renderRunPdf([{ document, face: "front" }], { size: "A5" });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("throws on an empty run rather than emitting a page-less PDF", async () => {
    await expect(renderRunPdf([])).rejects.toThrow(/no faces/i);
  });

  it("skips image elements gracefully when no resolver is supplied", async () => {
    // The image element in `document` has no resolver; rendering must still succeed.
    await expect(renderRunPdf([{ document, face: "front" }])).resolves.toBeInstanceOf(Buffer);
  });

  it("draws a QR placeholder when a face has no qrUrl", async () => {
    const pdf = await renderRunPdf([{ document, face: "front" }]);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

/**
 * The bottom strip of the card back is physically pre-printed on our stock with
 * the Kudos logo and QR, so the engine must refuse to lay ink there no matter
 * what a design says — see card-format.ts BACK_RESERVED_FOOTER_MM.
 *
 * These read the actual PDF content stream rather than just checking the file
 * parses. A smoke test would pass with the clip deleted; the whole point of
 * enforcing this in the print engine (and not only in the editor) is that it is
 * the last line of defence for designs saved before the rule existed.
 */
describe("reserved back footer", () => {
  /** Inflate every FlateDecode stream in a PDF and return them as text. pdfkit
   * compresses content streams, so the drawing operators aren't readable raw. */
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

  /** The one content stream carrying drawing operators (the others are embedded
   * font subsets). Throws rather than returning undefined so a test that can't
   * find it fails loudly instead of silently asserting nothing. */
  function drawingStream(pdf: Buffer): string {
    const stream = contentStreams(pdf).find((s) => / re\s+W n/.test(s));
    if (!stream) throw new Error("no drawing stream found in PDF");
    return stream;
  }

  /** The `x y w h re W n` clip rectangles in a content stream, in order. */
  function clipRects(stream: string): { x: number; y: number; w: number; h: number }[] {
    const re = /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re\s+W n/g;
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(stream))) {
      rects.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) });
    }
    return rects;
  }

  /** A back face doing the worst thing a customer can do: a full-bleed dark
   * background plus an element sitting squarely in the reserved band. */
  const advertBack: DesignDocument = {
    version: 1,
    pages: [
      { name: "front", elements: [] },
      {
        name: "back",
        background: { type: "color", color: "#101010" },
        elements: [
          {
            kind: "shape",
            id: "ad",
            shape: "rect",
            x: 20,
            y: 540,
            width: 410,
            height: 80,
            fill: "#ff0000",
            rotation: 0,
          },
        ],
      },
    ],
  };

  const PT_PER_MM = 72 / 25.4;

  it.each(CARD_SIZES)("clips the back to 30mm above the trim edge on %s", async (size) => {
    const pdf = await renderRunPdf([{ document: advertBack, face: "back" }], { size, bleedMm: 3 });
    const [pageClip] = clipRects(drawingStream(pdf));
    if (!pageClip) throw new Error("no clip rectangle on the back face");

    // pdfkit draws in a y-down space (it flips the page at the top of the
    // stream), so the clip runs from the page top down to the band. What's left
    // below it is the reserved band plus the bottom bleed.
    const { heightMm } = CARD_SIZE_DIMENSIONS_MM[size];
    const pageHeightPt = (heightMm + 6) * PT_PER_MM;
    const unreservedPt = pageHeightPt - pageClip.h;
    const reservedMm = unreservedPt / PT_PER_MM - 3; // less the bottom bleed

    // At least the full 30mm — on A5 the design is centred in the trim, so the
    // band lands a hair high, which over-reserves rather than under-reserves.
    expect(reservedMm).toBeGreaterThanOrEqual(BACK_RESERVED_FOOTER_MM - 1e-6);
    expect(reservedMm).toBeLessThan(BACK_RESERVED_FOOTER_MM + 1);
  });

  it("applies the clip before the background, so a full-bleed background can't cover the logo", async () => {
    const pdf = await renderRunPdf([{ document: advertBack, face: "back" }]);
    const stream = drawingStream(pdf);
    // The dark background is painted to the page edge; it must come after the
    // clip in the stream or it would print straight over the pre-printed strip.
    const clipAt = stream.search(/ re\s+W n/);
    const backgroundAt = stream.indexOf("0.06274509803921569");
    expect(backgroundAt).toBeGreaterThan(-1);
    expect(clipAt).toBeGreaterThan(-1);
    expect(clipAt).toBeLessThan(backgroundAt);
  });

  it("leaves the other three faces entirely to the customer", async () => {
    for (const face of ["front", "inside-left", "inside-right"] as const) {
      const pdf = await renderRunPdf([{ document, face }]);
      const rects = clipRects(drawingStream(pdf));
      // Only the design-space clip (the 450×634 stage), no reserved band.
      expect(rects).toHaveLength(1);
      expect(rects[0]).toMatchObject({ w: CARD_WIDTH, h: CARD_HEIGHT });
    }
  });
});
