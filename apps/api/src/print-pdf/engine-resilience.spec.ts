import zlib from "node:zlib";
import sharp from "sharp";
import { MAX_ARTWORK_PIXELS, MAX_DECODE_PIXELS } from "@kudos/shared-types";
import { decodeImage } from "./image-loader";
import { renderRunPdf, type ImageResolver } from "./render";
import type { DesignDocument } from "@kudos/shared-types";

/**
 * The print engine has to survive its inputs, because it is about to become the
 * only way a card reaches paper (docs/card-print-quality-plan.md, D4).
 *
 * Everything here reproduces a failure that was real before this file existed:
 * a corrupt PNG took the whole API process down, a 74-byte PNG could demand
 * gigabytes, and one background was written into the PDF once per page.
 */

/** A minimal, valid PNG chunk writer — used to hand-build hostile headers. */
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  let c = ~0;
  for (const byte of typed) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  crc.writeUInt32BE(~c >>> 0);
  return Buffer.concat([len, typed, crc]);
}

/** A tiny PNG whose header *declares* an enormous image. The whole attack. */
function declaredSizePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.alloc(1024))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A real PNG with a valid header and a damaged pixel stream. */
async function corruptedPng(): Promise<Buffer> {
  const good = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 10, g: 200, b: 10, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const buf = Buffer.from(good);
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    if (buf.toString("ascii", offset + 4, offset + 8) === "IDAT" && len > 20) {
      for (let i = 12; i < 20; i++) {
        const at = offset + 8 + i;
        buf[at] = (buf[at] ?? 0) ^ 0xff;
      }
      return buf;
    }
    offset += 12 + len;
  }
  throw new Error("fixture: no IDAT chunk large enough to corrupt");
}

function documentWithBackground(assetUrl: string): DesignDocument {
  return {
    version: 1,
    pages: [
      { name: "front", background: { type: "image", assetUrl }, elements: [] },
      { name: "inside-left", elements: [] },
      { name: "inside-right", elements: [] },
      { name: "back", elements: [] },
    ],
  };
}

describe("decodeImage resilience", () => {
  it("refuses a header that declares more pixels than we will decode", async () => {
    // 74 bytes on the wire, 256 megapixels declared. Both existing limits — the
    // bucket's 10MB and the loader's 25MB — see nothing wrong with it.
    const bomb = declaredSizePng(16000, 16000);
    expect(bomb.length).toBeLessThan(200);
    expect(16000 * 16000).toBeGreaterThan(MAX_DECODE_PIXELS);

    const warnings: string[] = [];
    const result = await decodeImage(bomb, "image/png", "https://x.test/bomb.png", {
      onWarn: (m) => warnings.push(m),
    });

    expect(result).toBeNull();
    expect(warnings.join(" ")).toContain("exceeds the decode limit");
  });

  it("turns a corrupt PNG into a skipped asset instead of a dead process", async () => {
    // Before this, sharp's header read passed, doc.image() returned without
    // throwing, and png-js rethrew inside a zlib callback — outside every
    // try/catch on the path — killing the process mid print run.
    const warnings: string[] = [];
    const result = await decodeImage(await corruptedPng(), "image/png", "https://x.test/bad.png", {
      onWarn: (m) => warnings.push(m),
    });

    expect(result).toBeNull();
    expect(warnings.join(" ")).toContain("undecodable");
  });

  it("re-encodes PNG rather than passing the original bytes to pdfkit", async () => {
    // The guarantee is not "these bytes look fine" but "we decoded these bytes
    // ourselves", which is the only thing that makes the case above catchable.
    const original = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();

    const result = await decodeImage(original, "image/png", "https://x.test/a.png", {});

    expect(result).not.toBeNull();
    expect(result!.data.equals(original)).toBe(false);
    expect(result!.width).toBe(40);
    expect(result!.height).toBe(40);
  });

  it("still passes a JPEG through untouched", async () => {
    // pdfkit embeds the DCT stream without decoding it, so there is nothing to
    // protect against — and re-encoding would throw away detail for nothing.
    const jpeg = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .toBuffer();

    const result = await decodeImage(jpeg, "image/jpeg", "https://x.test/a.jpg", {});

    expect(result!.data.equals(jpeg)).toBe(true);
  });

  it("downscales an oversized photo rather than dropping it from the card", async () => {
    // A real 50-megapixel upload is a customer sending us a real photo. The card
    // cannot show those pixels, but it must still show the picture.
    const side = Math.ceil(Math.sqrt(MAX_ARTWORK_PIXELS)) + 400;
    const huge = await sharp({
      create: { width: side, height: side, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .png()
      .toBuffer();

    const warnings: string[] = [];
    const result = await decodeImage(huge, "image/png", "https://x.test/big.png", {
      onWarn: (m) => warnings.push(m),
    });

    expect(result).not.toBeNull();
    expect(result!.width * result!.height).toBeLessThanOrEqual(MAX_ARTWORK_PIXELS);
    // Shape preserved — a downscale must not become a distortion.
    expect(result!.width / result!.height).toBeCloseTo(1, 2);
    expect(warnings.join(" ")).toContain("downscaled");
  });
});

describe("renderRunPdf embedding", () => {
  it("embeds one background once, however many pages draw it", async () => {
    const png = await sharp({
      create: { width: 1240, height: 1748, channels: 3, background: { r: 30, g: 90, b: 200 } },
    })
      .png()
      .toBuffer();
    const resolver: ImageResolver = () => Promise.resolve({ data: png, width: 1240, height: 1748 });

    const one = documentWithBackground("https://x.test/bg.png");
    const faces = Array.from({ length: 30 }, () => ({ document: one, face: "front" as const }));

    const pdf = await renderRunPdf(faces, {
      imageResolver: resolver,
      cropMarks: false,
      bleedMm: 0,
    });

    // Thirty pages of one image must not cost thirty copies of it. Before the
    // per-document memo this measured 30.9x on fifty pages.
    expect(pdf.length).toBeLessThan(png.length * 3);
  });

  it("skips an unresolvable background and still produces the run", async () => {
    const resolver: ImageResolver = () => Promise.resolve(null);
    const faces = [
      { document: documentWithBackground("https://x.test/gone.png"), face: "front" as const },
    ];

    const pdf = await renderRunPdf(faces, {
      imageResolver: resolver,
      cropMarks: false,
      bleedMm: 0,
    });

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("resolves each asset once per document, not once per page", async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 1, b: 1 } },
    })
      .png()
      .toBuffer();
    let calls = 0;
    const resolver: ImageResolver = () => {
      calls += 1;
      return Promise.resolve({ data: png, width: 20, height: 20 });
    };
    const one = documentWithBackground("https://x.test/bg.png");

    await renderRunPdf(
      Array.from({ length: 8 }, () => ({ document: one, face: "front" as const })),
      { imageResolver: resolver, cropMarks: false, bleedMm: 0 },
    );

    expect(calls).toBe(1);
  });
});
