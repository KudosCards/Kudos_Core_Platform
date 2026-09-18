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
  BACK_FOOTER_CAPTION,
  type BackFooterMode,
  CARD_HEIGHT,
  CARD_WIDTH,
  DEFAULT_CARD_SIZE,
  backFooterLayout,
  backReservedFooterTop,
  textWrapWidth,
  type CardSize,
  type DesignDocument,
  type DesignElement,
  type DesignPage,
} from "@kudos/shared-types";
import {
  cropMarks,
  CROP_MARK_WEIGHT_PT,
  faceGeometry,
  foldedSheetGeometry,
  type FaceGeometry,
  type FoldedSheetGeometry,
} from "./geometry";
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

/**
 * A pdfkit image already opened against the document, ready to draw on any page.
 *
 * pdfkit de-duplicates an image only when you hand it a **string** — `openImage`
 * fills `_imageRegistry[src]` under `if (typeof src === 'string')`, and `image()`
 * consults that registry under the same guard. We hand it Buffers, so every draw
 * used to create a fresh PDFImage and write another full copy of the bytes into
 * the file: fifty pages of one background measured **30.9x** the size of the same
 * run with the image opened once. On a 500-recipient run that is the difference
 * between a PDF an operator can print and one that exhausts the API's memory
 * before it finishes.
 *
 * Opening it ourselves and passing the resulting object takes pdfkit's
 * `if (src.width && src.height) image = src` branch, which reuses the one XObject
 * on every page. @types/pdfkit does not model that branch, hence the casts below.
 */
type EmbeddedImage = { width: number; height: number };

/** Draws an already-embedded image, or null when the asset could not be had. */
type ImageEmbedder = (assetUrl: string) => Promise<EmbeddedImage | null>;

interface DocumentWithOpenImage {
  openImage(src: Buffer): EmbeddedImage;
}

/**
 * Resolve each asset once per *document* rather than once per page.
 *
 * The resolver's own cache de-duplicates the fetch and the decode, which is what
 * hid the duplication above: one asset was downloaded once and then embedded N
 * times. This memoises the embed as well.
 */
function createImageEmbedder(
  doc: PDFKit.PDFDocument,
  resolver: ImageResolver | undefined,
  onWarn?: (message: string) => void,
): ImageEmbedder {
  const embedded = new Map<string, EmbeddedImage | null>();
  return async (assetUrl: string) => {
    const cached = embedded.get(assetUrl);
    if (cached !== undefined) return cached;
    let image: EmbeddedImage | null = null;
    if (resolver) {
      const resolved = await resolver(assetUrl);
      if (resolved) {
        try {
          image = (doc as unknown as DocumentWithOpenImage).openImage(resolved.data);
        } catch (error) {
          // A header pdfkit cannot parse. Skipped like any other unusable asset
          // rather than failing the run — the same policy as the resolver (ADR 0162).
          onWarn?.(`print image unembeddable (${assetUrl}): ${String(error)}`);
        }
      }
    }
    embedded.set(assetUrl, image);
    return image;
  };
}

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
  /** Optional warn sink for assets that could not be embedded. */
  onWarn?: (message: string) => void;
  /**
   * What to do with the 30 mm strip across the bottom of the back.
   *
   * `"reserved"` (the default, and what every run does today) keeps customer
   * content out of it and leaves it blank, because the strip is already printed
   * on the stock. `"print"` draws it here instead — the band, this card's QR,
   * the caption and the Kudos mark — which is what blank stock needs. Switching
   * it on against pre-printed stock would overprint the branding, so it is a
   * deliberate choice, never a default.
   */
  backFooter?: BackFooterMode;
  /**
   * Draw the grey placeholder square for a QR element on a card with no message
   * page. True (the editor's preview behaviour) for the face-per-page output;
   * the folded sheet turns it off, because a placeholder on a card that is about
   * to be posted is a square the recipient can only read as a printing fault.
   */
  qrPlaceholder?: boolean;
  /**
   * Absolute URL of the Kudos mark for `backFooter: "print"`, fetched through the
   * same allow-listed resolver as any other asset. Omitted = no mark drawn.
   */
  logoUrl?: string;
}

/** One card, for the folded-sheet layout — which needs all four faces together
 * on two sheets, not a flat list of faces. */
export interface PrintCardInput {
  document: DesignDocument;
  qrUrl?: string;
}

/** The per-face choices the panel renderer needs, resolved once per run. */
interface FaceDrawOptions {
  backFooter: BackFooterMode;
  qrPlaceholder: boolean;
  logoUrl?: string;
}

/** The font the printed footer caption is set in — a brand sans with a real
 * bold, so the strip reads as ours rather than as the customer's design. */
const FOOTER_FONT_FAMILY = "Montserrat";

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
export async function renderRunPdf(
  faces: PrintFaceInput[],
  options: RenderRunOptions = {},
): Promise<Buffer> {
  const size = options.size ?? DEFAULT_CARD_SIZE;
  const withCropMarks = options.cropMarks ?? true;
  const geometry = faceGeometry(size, options.bleedMm);

  // A zero-face run would finalise a page-less (invalid) PDF; fail loud instead
  // so the caller reports "nothing to print" rather than streaming a broken file.
  if (faces.length === 0) {
    throw new Error("renderRunPdf: no faces to render");
  }

  return buildPdf(options, async (doc, embed) => {
    const draw = faceDrawOptions(options, true);
    for (const entry of faces) {
      doc.addPage({ size: [geometry.pageWidthPt, geometry.pageHeightPt], margin: 0 });

      await renderFace(doc, entry, geometry, size, embed, draw);
      if (withCropMarks) drawCropMarks(doc, geometry);
    }
  });
}

/**
 * The outside of the sheet, left panel first. Folding the left half *behind* the
 * right leaves the right half facing out, so the right panel is the front cover
 * and the left is the back.
 */
const OUTSIDE_PANELS: DesignPage["name"][] = ["back", "front"];
/**
 * The inside, left panel first — and the same order, which is the part worth
 * explaining.
 *
 * Manual duplex turns the stack about the sheet's short edge: the operator turns
 * it like a page, left to right. That mirrors the sheet horizontally, so what
 * was printed on the right half of side one is now the left half of side two —
 * which is exactly the panel the card opens onto. It also leaves top and bottom
 * where they were, so nothing needs rotating.
 *
 * That is not an assumption. The P0 duplex test printed an arrow on each side
 * and both came back pointing at the top edge; a turn about the *long* edge
 * would have inverted the second one and the insides would print upside-down.
 * If that ever changes at the printer, this is the constant that changes with it.
 */
const INSIDE_PANELS: DesignPage["name"][] = ["inside-left", "inside-right"];

/** Pages per card in the folded layout: one sheet outside, one sheet inside. */
const FOLDED_SHEETS: DesignPage["name"][][] = [OUTSIDE_PANELS, INSIDE_PANELS];

export interface FoldedRunOptions extends Omit<RenderRunOptions, "cropMarks" | "bleedMm"> {
  /**
   * The long-edge loss read off the borderless calibration sheet, in mm. The
   * sheet's contents are drawn that much smaller so the driver's enlargement
   * brings the trim back to the paper edge. Defaults to 0 — full size, which is
   * also correct for a printer that is not enlarging.
   */
  borderlessOverhangMm?: number;
  /** Placement offsets from the calibration sheet: `(left − right) ÷ 2` and
   *  `(top − bottom) ÷ 2`. Default 0 — the sheet is drawn where it falls. */
  borderlessOffsetXMm?: number;
  borderlessOffsetYMm?: number;
}

/**
 * Render a print run as the sheets the printer actually takes: one landscape
 * sheet per side of each card, two faces to a sheet, fold down the middle.
 *
 * Pages come out interleaved — card 1 outside, card 1 inside, card 2 outside,
 * card 2 inside — so the odd pages are every outside and the even pages every
 * inside. That is the order manual duplex wants: print odd pages, turn the
 * stack, print even pages.
 *
 * A face the design does not carry prints as a blank white panel. It is not
 * substituted with the front (which the single-face renderer does defensively),
 * because on a real card that would post the cover artwork on the back.
 */
export async function renderFoldedRunPdf(
  cards: PrintCardInput[],
  options: FoldedRunOptions = {},
): Promise<Buffer> {
  const size = options.size ?? DEFAULT_CARD_SIZE;
  const sheet = foldedSheetGeometry(size, options.borderlessOverhangMm, {
    xMm: options.borderlessOffsetXMm,
    yMm: options.borderlessOffsetYMm,
  });

  if (cards.length === 0) {
    throw new Error("renderFoldedRunPdf: no cards to render");
  }

  return buildPdf(options, async (doc, embed) => {
    // A placeholder QR is a preview affordance; these pages get posted.
    const draw = faceDrawOptions(options, false);
    for (const card of cards) {
      for (const panels of FOLDED_SHEETS) {
        doc.addPage({ size: [sheet.pageWidthPt, sheet.pageHeightPt], margin: 0 });
        doc.save();
        applyBorderlessCompensation(doc, sheet);

        for (const [index, face] of panels.entries()) {
          doc.save();
          doc.translate(sheet.panelXPt[index] ?? 0, 0);
          await renderPanel(
            doc,
            pageNamed(card.document, face),
            face,
            card.qrUrl,
            sheet.panel,
            size,
            embed,
            draw,
          );
          doc.restore();
        }

        doc.restore();
      }
    }
  });
}

/**
 * Put the sheet where the paper actually is, and at the size the paper actually
 * takes: a translation for a printer that places the sheet off centre, then a
 * scale about the centre for the driver's borderless enlargement.
 *
 * Both, because they are different faults. The scale corrects a page the driver
 * blows up; centring it gets both axes right at once, since the enlargement is
 * uniform and the short edge loses proportionally less. The shift corrects paper
 * arriving somewhere other than where the driver thinks, which no amount of
 * scaling touches — enlarging a card that is in the wrong place leaves it in the
 * wrong place, just bigger.
 *
 * The translation comes first so it is not itself scaled twice: `shiftXPt`
 * already carries the shrink (see `borderlessShiftMm`).
 *
 * A no-op when nothing has been measured, so a sheet that needs no correction is
 * not moved about at all.
 */
function applyBorderlessCompensation(doc: PDFKit.PDFDocument, sheet: FoldedSheetGeometry): void {
  const { shrink, shiftXPt, shiftYPt, pageWidthPt, pageHeightPt } = sheet;
  if (shiftXPt !== 0 || shiftYPt !== 0) doc.translate(shiftXPt, shiftYPt);
  if (shrink === 1) return;
  doc.translate(pageWidthPt / 2, pageHeightPt / 2);
  doc.scale(shrink);
  doc.translate(-pageWidthPt / 2, -pageHeightPt / 2);
}

/** The run-wide face choices, with the layout's own default for the placeholder. */
function faceDrawOptions(options: RenderRunOptions, placeholderDefault: boolean): FaceDrawOptions {
  return {
    backFooter: options.backFooter ?? "reserved",
    qrPlaceholder: options.qrPlaceholder ?? placeholderDefault,
    logoUrl: options.logoUrl,
  };
}

/** The exact page of a document, with no fallback — see `renderFoldedRunPdf`. */
function pageNamed(document: DesignDocument, face: DesignPage["name"]): DesignPage | undefined {
  return document.pages.find((page) => page.name === face);
}

/** Create the document, collect its bytes, run `build`, and resolve to the PDF. */
async function buildPdf(
  options: RenderRunOptions,
  build: (doc: PDFKit.PDFDocument, embed: ImageEmbedder) => Promise<void>,
): Promise<Buffer> {
  const doc = new PDFDocument({
    autoFirstPage: false,
    info: { Title: options.title ?? "Kudos print run" },
  });

  const embed = createImageEmbedder(doc, options.imageResolver, options.onWarn);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  await build(doc, embed);

  doc.end();
  return done;
}

/** Draw one face onto the current page of `doc`, at the page's own origin. */
async function renderFace(
  doc: PDFKit.PDFDocument,
  entry: PrintFaceInput,
  geometry: FaceGeometry,
  size: CardSize,
  embed: ImageEmbedder,
  draw: FaceDrawOptions,
): Promise<void> {
  return renderPanel(
    doc,
    pageForFace(entry.document, entry.face),
    entry.face,
    entry.qrUrl,
    geometry,
    size,
    embed,
    draw,
  );
}

/**
 * Draw one face into the box at the current origin.
 *
 * Everything is relative to that origin and to `geometry`'s own page size, which
 * is what lets the folded-sheet layout place two of these side by side on one
 * sheet without the face renderer knowing anything about sheets.
 *
 * `page` is passed in rather than looked up, so the caller decides what a
 * missing face means: the single-face path falls back to the front, the folded
 * sheet leaves the panel blank.
 */
async function renderPanel(
  doc: PDFKit.PDFDocument,
  page: DesignPage | undefined,
  face: DesignPage["name"],
  qrUrl: string | undefined,
  geometry: FaceGeometry,
  size: CardSize,
  embed: ImageEmbedder,
  draw: FaceDrawOptions,
): Promise<void> {
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
    face === "back"
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
      doc
        .rect(0, 0, geometry.pageWidthPt, geometry.pageHeightPt)
        .fillColor(bg.color, bg.opacity)
        .fill();
    } else {
      await drawImageBackground(doc, page.background.assetUrl, geometry, embed);
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
    await drawElement(doc, element, qrUrl, embed, draw.qrPlaceholder);
  }

  doc.restore();

  if (reservedFromPt !== null) {
    doc.restore();

    // Outside the clip, so it can paint over the band the clip kept empty.
    if (draw.backFooter === "print") {
      await drawBackFooter(doc, geometry, size, reservedFromPt, qrUrl, embed, draw.logoUrl);
    }
  }
}

/** Dispatch one element to its drawer. */
async function drawElement(
  doc: PDFKit.PDFDocument,
  element: DesignElement,
  qrUrl: string | undefined,
  embed: ImageEmbedder,
  qrPlaceholder: boolean,
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
      else if (qrPlaceholder) drawQrPlaceholder(doc, element.size);
      doc.restore();
      return;
    case "image":
      await drawImageElement(doc, element, embed);
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
function drawText(
  doc: PDFKit.PDFDocument,
  element: Extract<DesignElement, { kind: "text" }>,
): void {
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
        doc.text(run.text, element.fontSize * BOLD_OFFSET, 0, {
          baseline: "alphabetic",
          lineBreak: false,
        });
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
  embed: ImageEmbedder,
): Promise<void> {
  const image = await embed(element.assetUrl);
  if (!image) return;
  doc.save();
  doc.translate(element.x, element.y);
  if (element.rotation) doc.rotate(element.rotation);
  doc.image(image as unknown as Buffer, 0, 0, {
    width: element.width,
    height: element.height,
  });
  doc.restore();
}

/** Draw a cover-cropped background image over the whole bleed page (page points). */
async function drawImageBackground(
  doc: PDFKit.PDFDocument,
  assetUrl: string,
  geometry: ReturnType<typeof faceGeometry>,
  embed: ImageEmbedder,
): Promise<void> {
  const image = await embed(assetUrl);
  if (!image) return;
  // pdfkit's `cover` fits the image to the box centre-cropped — the same rule as
  // the editor's coverCrop, applied to the full page so the background bleeds.
  doc.image(image as unknown as Buffer, 0, 0, {
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

/**
 * Draw the back's bottom strip in-house: the white band, this card's QR, the
 * caption and the Kudos mark (docs/card-print-quality-plan.md, P4).
 *
 * The band is filled in *page* points, from the reserved line to the bottom of
 * the page, so it covers the whole strip on either card size — the design is
 * centred within the trim on A5, and filling the design's band would leave a
 * 0.75 mm sliver of the customer's background showing below it. The contents are
 * then placed in design units, where the shared layout lives.
 *
 * A card with no message page gets the band and the mark and nothing else. The
 * caption is not drawn without a QR to explain, and no placeholder stands in for
 * one: "Scan to see your message" beside a grey square is an instruction the
 * recipient cannot follow.
 */
async function drawBackFooter(
  doc: PDFKit.PDFDocument,
  geometry: FaceGeometry,
  size: CardSize,
  reservedFromPt: number,
  qrUrl: string | undefined,
  embed: ImageEmbedder,
  logoUrl: string | undefined,
): Promise<void> {
  const layout = backFooterLayout(size, Boolean(qrUrl));

  doc.save();
  doc
    .rect(0, reservedFromPt, geometry.pageWidthPt, geometry.pageHeightPt - reservedFromPt)
    .fill("#ffffff");
  doc.restore();

  doc.save();
  doc.translate(geometry.translateXPt, geometry.translateYPt);
  doc.scale(geometry.scalePtPerUnit);

  if (layout.qr && qrUrl) {
    doc.save();
    doc.translate(layout.qr.x, layout.qr.y);
    drawQr(doc, layout.qr.width, qrUrl);
    doc.restore();
  }

  if (layout.caption) drawFooterCaption(doc, layout.caption);

  if (logoUrl) {
    const image = await embed(logoUrl);
    if (image) {
      doc.image(image as unknown as Buffer, layout.logo.x, layout.logo.y, {
        width: layout.logo.width,
        height: layout.logo.height,
      });
    }
  }

  doc.restore();
}

/**
 * The footer caption, wrapped to its box and centred in it both ways.
 *
 * Uses the same baseline convention as every other line of text the engine draws
 * (`baselineMetrics` + an alphabetic baseline), so the words sit on the QR's
 * optical centre rather than a pdfkit default that would ride high.
 */
function drawFooterCaption(
  doc: PDFKit.PDFDocument,
  box: { x: number; y: number; width: number; height: number; fontSize: number },
): void {
  const fontName = registerFace(doc, resolveFace(FOOTER_FONT_FAMILY, false, false));
  doc.font(fontName).fontSize(box.fontSize);

  const metrics = (doc as unknown as { _font: FontMetrics })._font;
  const ascentEm = metrics.ascender / 1000;
  const descentEm = -metrics.descender / 1000;

  const lines = wrapText(BACK_FOOTER_CAPTION, box.width, (text) => doc.widthOfString(text));
  const { lineHeightPx, firstBaseline } = baselineMetrics(box.fontSize, ascentEm, descentEm);
  const blockTop = box.y + Math.max(0, (box.height - lineHeightPx * lines.length) / 2);

  doc.save();
  doc.fillColor("#000000");
  lines.forEach((line, index) => {
    if (line === "") return;
    const x = box.x + alignOffset("center", box.width, doc.widthOfString(line));
    doc.text(line, x, blockTop + firstBaseline + index * lineHeightPx, {
      baseline: "alphabetic",
      lineBreak: false,
    });
  });
  doc.restore();
}
