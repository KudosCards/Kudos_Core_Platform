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
  backReservedFooterTop,
  textWrapWidth,
  type CardSize,
  type DesignDocument,
  type DesignElement,
  type DesignPage,
} from "@kudos/shared-types";
import { cropMarks, CROP_MARK_WEIGHT_PT, faceGeometry, type FaceGeometry } from "./geometry";
import { fallbackFaces, registerFace, resolveFace, type FontFace } from "./fonts";
import { coverageForFace } from "./coverage";
import { splitGlyphRuns } from "./glyph-runs";
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
  /** Draw registration/crop marks in the bleed. Default true. Set false when the
   * card is printed and folded rather than trimmed (nothing to cut to). */
  cropMarks?: boolean;
  /** Bleed beyond the trim, in millimetres. Defaults to the print-house standard
   * (3 mm). Pass 0 for a page at the exact trim size — the right output for a
   * print-and-fold card, where there's no bleed to trim off. */
  bleedMm?: number;
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
  const geometry = faceGeometry(size, options.bleedMm);

  // A zero-face run would finalise a page-less (invalid) PDF; fail loud instead
  // so the caller reports "nothing to print" rather than streaming a broken file.
  if (faces.length === 0) {
    throw new Error("renderRunPdf: no faces to render");
  }

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
     
    await renderFace(doc, entry, geometry, size, options.imageResolver);
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
  size: CardSize,
  imageResolver?: ImageResolver,
): Promise<void> {
  const page = pageForFace(entry.document, entry.face);
  const elements = page?.elements ?? [];

  // The back's bottom strip is already printed on the stock — the Kudos logo and
  // QR — so nothing the customer authored may be drawn over it.
  //
  // Enforced here rather than only in the editor because the editor is a
  // convenience and this is the guarantee: a design saved before the rule
  // existed, or one built by any other route, still cannot reach the branding.
  // Clipped rather than rejected so one stray element costs its own bottom edge,
  // not the customer's whole card.
  //
  // The band is derived from the same shared `backReservedFooterTop` the editor
  // guide uses, so what the customer is shown and what the printer enforces can
  // never disagree. Measured from the *design's* bottom rather than the trim's,
  // which are the same edge on A6 and 0.75 mm apart on A5 (the design is
  // centred there) — so on A5 print reserves a hair more than the physical
  // 30 mm, never less.
  const reservedFromPt =
    entry.face === "back"
      ? geometry.translateYPt + backReservedFooterTop(size) * geometry.scalePtPerUnit
      : null;

  // Applied at page level, before the background: a background bleeds to the
  // page edge, so clipping only the design space would let a full-bleed image
  // on the back print straight over the logo.
  if (reservedFromPt !== null) {
    doc.save();
    doc.rect(0, 0, geometry.pageWidthPt, reservedFromPt).clip();
  }

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

  if (reservedFromPt !== null) {
    doc.restore();
  }
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
 * alphabetic baseline, rotation about top-left, bold/italic/underline/colour).
 *
 * Each line is split into glyph runs (docs/adr/0162, Phase 3): characters the
 * chosen font lacks — emoji, symbols — are drawn from a fallback font instead of
 * a missing-glyph box, matching the browser. Pure-Latin text is one run in the
 * primary font, byte-identical to before. Wrap/align measure the *mixed* width
 * so lines still break and centre where the editor puts them. */
function drawText(doc: PDFKit.PDFDocument, element: Extract<DesignElement, { kind: "text" }>): void {
  const primary = resolveFace(element.fontFamily, Boolean(element.bold), Boolean(element.italic));
  // Primary first, then the ordered fallbacks — index 0 is the element's font.
  const faces: FontFace[] = [primary, ...fallbackFaces()];
  const fontNames = faces.map((face) => registerFace(doc, face));
  const coverages = faces.map(coverageForFace);

  // Vertical metrics come from the primary font (Konva measures the element's
  // own font); read after selecting it, before any run-measuring swaps the font.
  doc.font(fontNames[0]!).fontSize(element.fontSize);
  const metrics = (doc as unknown as { _font: FontMetrics })._font;
  const ascentEm = metrics.ascender / 1000;
  const descentEm = -metrics.descender / 1000;

  /** Width of a string as the sum of its per-font run widths (leaves the primary
   * font selected). Used for wrap and per-line alignment. */
  const measureMixed = (s: string): number => {
    let total = 0;
    for (const run of splitGlyphRuns(s, coverages)) {
      doc.font(fontNames[run.fontIndex]!).fontSize(element.fontSize);
      total += doc.widthOfString(run.text);
    }
    doc.font(fontNames[0]!).fontSize(element.fontSize);
    return total;
  };

  const boxWidth = textWrapWidth(element);
  const lines = wrapText(element.text, boxWidth, measureMixed);
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
    const runs = splitGlyphRuns(line, coverages);
    // Measure each run once (in its own font); the line width drives alignment.
    const runWidths = runs.map((run) => {
      doc.font(fontNames[run.fontIndex]!).fontSize(element.fontSize);
      return doc.widthOfString(run.text);
    });
    const lineWidth = runWidths.reduce((sum, w) => sum + w, 0);
    const x = alignOffset(align, boxWidth, lineWidth);
    const baseline = firstBaseline + index * lineHeightPx;

    let penX = x;
    runs.forEach((run, runIndex) => {
      const face = faces[run.fontIndex]!;
      doc.font(fontNames[run.fontIndex]!).fontSize(element.fontSize);
      doc.save();
      doc.translate(penX, baseline);
      // Synthesised bold/italic only applies to the element's own font, never to
      // a fallback glyph (a sheared/thickened emoji would look wrong).
      const isPrimary = run.fontIndex === 0;
      if (isPrimary && face.synthesizeItalic) doc.transform(1, 0, ITALIC_SHEAR, 1, 0, 0);
      doc.fillColor(color.color, color.opacity);
      doc.text(run.text, 0, 0, { baseline: "alphabetic", lineBreak: false });
      if (isPrimary && face.synthesizeBold) {
        doc.text(run.text, element.fontSize * BOLD_OFFSET, 0, { baseline: "alphabetic", lineBreak: false });
      }
      doc.restore();
      penX += runWidths[runIndex]!;
    });

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
