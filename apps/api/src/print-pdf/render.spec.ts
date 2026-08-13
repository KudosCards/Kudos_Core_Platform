import type { DesignDocument } from "@kudos/shared-types";
import { renderRunPdf } from "./render";

/** A document exercising every element kind + a colour background. */
const document: DesignDocument = {
  version: 1,
  pages: [
    {
      name: "front",
      background: { type: "color", color: "#faf5ff" },
      elements: [
        { kind: "text", id: "t", text: "Happy Birthday, Sam!", x: 30, y: 60, width: 380, align: "center", fontFamily: "Playfair Display", fontSize: 32, color: "#4c1d95", bold: true },
        { kind: "shape", id: "s", shape: "heart", x: 200, y: 200, width: 50, height: 50, fill: "#ef4444", rotation: 0 },
        { kind: "qr", id: "q", x: 320, y: 500, size: 90, rotation: 0 },
        // An image element with no resolver supplied — must be skipped, not throw.
        { kind: "image", id: "i", assetUrl: "https://example.com/a.png", x: 20, y: 300, width: 120, height: 120, rotation: 0 },
      ],
    },
    { name: "inside-right", elements: [{ kind: "text", id: "t2", text: "With love", x: 40, y: 300, fontFamily: "Lora", fontSize: 20, color: "#111111", italic: true }] },
  ],
};

function pdfPageCount(pdf: Buffer): number {
  const match = pdf.toString("latin1").match(/\/Count (\d+)/);
  return match ? Number(match[1]) : 0;
}

describe("renderRunPdf", () => {
  it("produces a valid PDF for a single face", async () => {
    const pdf = await renderRunPdf([{ document, face: "front", qrUrl: "https://kudoscards.co.uk/r/demo" }]);
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
