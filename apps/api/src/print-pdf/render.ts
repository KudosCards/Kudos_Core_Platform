/**
 * The server-side card→PDF engine (docs/adr/0162, print quality Phase 1).
 *
 * Renders a design document to a true print-house PDF: vector text in the exact
 * embedded font, vector shapes and QR codes, at real A5/A6 trim with 3 mm bleed
 * and crop marks. It reproduces the canonical read-only renderer
 * (card-face-preview.tsx) — white base → page background → elements in array
 * order — so print matches the editor. One physical page per face.
 *
 * Images (element artwork and cover-crop backgrounds) are drawn via an injected
 * async `ImageResolver`; the deterministic core here needs no network. When no
 * resolver is supplied, image elements/backgrounds are skipped (the white base
 * shows through) — the image pipeline is wired in a follow-up slice.
 */

import PDFDocument from "pdfkit";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  DEFAULT_CARD_SIZE,
  textWrapWidth,
  type CardSize,
  type DesignDocument,
  type DesignElement,
  type DesignPage,
} from "@kudos/shared-types";
import { cropMarks, CROP_MARK_WEIGHT_PT, faceGeometry, type FaceGeometry } from "./geometry";
import { registerFace, resolveFace } from "./fonts";
import { alignOffset, baselineMetrics, wrapText } from "./text-layout";
import { parseColor } from "./color";
import { drawShape } from "./shapes";
import { drawQr, drawQrPlaceholder } from "./qr";

/** Faux-italic shear for the few faces with no real italic (Pacifico, Lobster,
 * Dancing Script, Caveat) — ~12°, matching browser oblique synthesis. Negative so
 * ascenders lean right in pdfkit's y-down space; the baseline (y=0) is unmoved. */
const ITALIC_SHEAR = -0.2126;
/** Faux-bold thickening as a fraction of font size (Pacifico/Lobster bold only). */
const BOLD_OFFSET = 0.03;

/** A resolved raster image ready to embed (PNG/JPEG bytes) with its natural size. */
export interface ResolvedImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Resolves a design asset URL to embeddable image bytes. Injected so the pure
 * engine stays network-free; implemented in the image-pipeline slice. */
export type ImageResolver = (assetUrl: string) => Promise<ResolvedImage | null>;

/** One physical page: a (already merge-tokenised) document, which face to draw,
 * and the absolute link this card's QR should encode. */
export interface PrintFaceInput {
  document: DesignDocument;
  face: DesignPage["name"];
  qrUrl?: string;
}

export interface RenderRunOptions {
  /** Trim size for the whole run. Defaults to the house size (A6). */
  size?: CardSize;
  /** Draw registration/crop marks in the bleed. Default true. */
  cropMarks?: boolean;
  /** Resolver for image elements + image backgrounds. Omitted = skip images. */
  imageResolver?: ImageResolver;
  /** PDF document metadata title. */
  title?: string;
}

/** pdfkit exposes the current font's em-scaled metrics on `_font`; typed narrowly. */
interface FontMetrics {
  ascender: number;
  descender: number;
}

/** Pick the page for a face, mirroring card-face-preview's fallback chain. */
function pageForFace(document: DesignDocument, face: DesignPage["name"]): DesignPage | undefined {
  return (
    document.pages.find((p) => p.name === face) ??
    document.pages.find((p) => p.name === "front") ??
    document.pages[0]
  );
}

/**
 * Render a whole print run to a single multi-page PDF (one page per face) and
 * resolve to its bytes.
 */
export async function renderRunPdf(faces: PrintFaceInput[], options: RenderRunOptions = {}): Promise<Buffer> {
  const size = options.size ?? DEFAULT_CARD_SIZE;
  const withCropMarks = options.cropMarks ?? true;
  const geometry = faceGeometry(size);

  const doc = new PDFDocument({
    autoFirstPage: false,
    info: { Title: options.title ?? "Kudos print run" },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  for (const entry of faces) {
    doc.addPage({ size: [geometry.pageWidthPt, geometry.pageHeightPt], margin: 0 });
     
    await renderFace(doc, entry, geometry, options.imageResolver);
    if (withCropMarks) drawCropMarks(doc, geometry);
  }

  doc.end();
  return done;
}

/** Draw one face onto the current page of `doc`. */
async function renderFace(
  doc: PDFKit.PDFDocument,
  entry: PrintFaceInput,
  geometry: FaceGeometry,
  imageResolver?: ImageResolver,
): Promise<void> {
  const page = pageForFace(entry.document, entry.face);
  const elements = page?.elements ?? [];

  // --- Page level (absolute points): white base, then background, both bleeding
  // to the page edge. ---
  doc.save();
  doc.rect(0, 0, geometry.pageWidthPt, geometry.pageHeightPt).fill("#ffffff");
  if (page?.background) {
    if (page.background.type === "color") {
      const bg = parseColor(page.background.color);
      doc.rect(0, 0, geometry.pageWidthPt, geometry.pageHeightPt).fillColor(bg.color, bg.opacity).fill();
    } else if (imageResolver) {
      await drawImageBackground(doc, page.background.assetUrl, geometry, imageResolver);
    }
  }
  doc.restore();

  // --- Design space: translate + uniform scale so we draw in 450×634 units,
  // clipped to the card rect (matching Konva's stage clip). ---
  doc.save();
  doc.translate(geometry.translateXPt, geometry.translateYPt);
  doc.scale(geometry.scalePtPerUnit);
  doc.rect(0, 0, CARD_WIDTH, CARD_HEIGHT).clip();

  for (const element of elements) {
     
    await drawElement(doc, element, entry.qrUrl, imageResolver);
  }

  doc.restore();
}

/** Dispatch one element to its drawer. */
async function drawElement(
  doc: PDFKit.PDFDocument,
  element: DesignElement,
  qrUrl: string | undefined,
  imageResolver: ImageResolver | undefined,
): Promise<void> {
  switch (element.kind) {
    case "text":
      drawText(doc, element);
      return;
    case "shape":
      doc.save();
      doc.translate(element.x, element.y);
      if (element.rotation) doc.rotate(element.rotation);
      drawShape(doc, element);
      doc.restore();
      return;
    case "qr":
      doc.save();
      doc.translate(element.x, element.y);
      if (element.rotation) doc.rotate(element.rotation);
      if (qrUrl) drawQr(doc, element.size, qrUrl);
      else drawQrPlaceholder(doc, element.size);
      doc.restore();
      return;
    case "image":
      if (imageResolver) await drawImageElement(doc, element, imageResolver);
      return;
  }
}

/** Draw a text element with full Konva fidelity (wrap, align, line-height 1.3,
 * alphabetic baseline, rotation about top-left, bold/italic/underline/colour). */
function drawText(doc: PDFKit.PDFDocument, element: Extract<DesignElement, { kind: "text" }>): void {
  const face = resolveFace(element.fontFamily, Boolean(element.bold), Boolean(element.italic));
  const fontName = registerFace(doc, face);
  doc.font(fontName).fontSize(element.fontSize);

  const metrics = (doc as unknown as { _font: FontMetrics })._font;
  const ascentEm = metrics.ascender / 1000;
  const descentEm = -metrics.descender / 1000;

  const boxWidth = textWrapWidth(element);
  const lines = wrapText(element.text, boxWidth, (s) => doc.widthOfString(s));
  const { lineHeightPx, firstBaseline } = baselineMetrics(element.fontSize, ascentEm, descentEm);
  const color = parseColor(element.color);
  const align = element.align ?? "left";
  const underlineY = Math.round(element.fontSize / 4);
  const underlineWeight = element.fontSize / 15;

  doc.save();
  doc.translate(element.x, element.y);
  if (element.rotation) doc.rotate(element.rotation);

  lines.forEach((line, index) => {
    if (line === "") return;
    const lineWidth = doc.widthOfString(line);
    const x = alignOffset(align, boxWidth, lineWidth);
    const baseline = firstBaseline + index * lineHeightPx;

    doc.save();
    doc.translate(x, baseline);
    if (face.synthesizeItalic) doc.transform(1, 0, ITALIC_SHEAR, 1, 0, 0);
    doc.fillColor(color.color, color.opacity);
    doc.text(line, 0, 0, { baseline: "alphabetic", lineBreak: false });
    if (face.synthesizeBold) {
      // Thicken by redrawing with a small horizontal offset (faux bold).
      doc.text(line, element.fontSize * BOLD_OFFSET, 0, { baseline: "alphabetic", lineBreak: false });
    }
    doc.restore();

    if (element.underline) {
      doc
        .save()
        .strokeColor(color.color, color.opacity)
        .lineWidth(underlineWeight)
        .moveTo(x, baseline + underlineY)
        .lineTo(x + lineWidth, baseline + underlineY)
        .stroke()
        .restore();
    }
  });

  doc.restore();
}

/** Draw an image element: stretched to its box and rotated about its top-left,
 * exactly like Konva's `<Image x y width height rotation>`. */
async function drawImageElement(
  doc: PDFKit.PDFDocument,
  element: Extract<DesignElement, { kind: "image" }>,
  imageResolver: ImageResolver,
): Promise<void> {
  const resolved = await imageResolver(element.assetUrl);
  if (!resolved) return;
  doc.save();
  doc.translate(element.x, element.y);
  if (element.rotation) doc.rotate(element.rotation);
  doc.image(resolved.data, 0, 0, { width: element.width, height: element.height });
  doc.restore();
}

/** Draw a cover-cropped background image over the whole bleed page (page points). */
async function drawImageBackground(
  doc: PDFKit.PDFDocument,
  assetUrl: string,
  geometry: ReturnType<typeof faceGeometry>,
  imageResolver: ImageResolver,
): Promise<void> {
  const resolved = await imageResolver(assetUrl);
  if (!resolved) return;
  // pdfkit's `cover` fits the image to the box centre-cropped — the same rule as
  // the editor's coverCrop, applied to the full page so the background bleeds.
  doc.image(resolved.data, 0, 0, {
    cover: [geometry.pageWidthPt, geometry.pageHeightPt],
    align: "center",
    valign: "center",
  });
}

/** Draw the crop marks for the current page (absolute points). */
function drawCropMarks(doc: PDFKit.PDFDocument, geometry: FaceGeometry): void {
  doc.save();
  doc.strokeColor("#000000").lineWidth(CROP_MARK_WEIGHT_PT);
  for (const m of cropMarks(geometry)) {
    doc.moveTo(m.x1, m.y1).lineTo(m.x2, m.y2).stroke();
  }
  doc.restore();
}
