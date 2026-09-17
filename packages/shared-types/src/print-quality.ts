/**
 * Print-resolution pre-flight (docs/adr/0162, Phase 2).
 *
 * A placed image only looks crisp in print if it carries enough source pixels for
 * the physical size it's printed at. This module is the one pure definition of
 * "effective print DPI" and the warn threshold, shared by the card editor (warn
 * the customer while they design) and the ops print flow (warn before printing).
 *
 * Effective DPI = source pixels along an axis ÷ that axis's printed length in
 * inches. We report the *lower* of the two axes (the limiting resolution), which
 * is conservative for both a stretched image element and a cover-cropped
 * background. Nothing here does I/O — callers pass the natural pixel size (from a
 * loaded image or `sharp` metadata) and the printed millimetre size.
 */

import type { DesignDocument } from "./card";
import { CARD_SIZE_DIMENSIONS_MM, type CardSize } from "./card-format";
import { CARD_WIDTH } from "./design-layout";

const MM_PER_INCH = 25.4;

/** The print-house target every image should meet. */
export const PRINT_DPI_TARGET = 300;

/**
 * The most pixels an image can usefully carry for a printed card, and the ceiling
 * the print engine downscales to.
 *
 * Derived, not chosen: the largest face we print at twice the target DPI. Above
 * this an image cannot make the card any better — 600 dpi is already beyond what
 * the paper resolves — while it costs memory in the renderer and bytes in the
 * PDF in direct proportion.
 *
 * It is a **downscale** ceiling rather than a refusal: a photographer's 50-megapixel
 * upload is a legitimate thing to send us, and the right answer is to print it
 * beautifully at the size it will actually appear, not to drop it.
 */
export const MAX_ARTWORK_PIXELS = maxPrintablePixels();

/**
 * The most pixels we will decode at all.
 *
 * Downscaling requires decoding, so an image big enough to exhaust memory during
 * the decode cannot be rescued by the ceiling above — it has to be refused before
 * `sharp` touches it. A PNG header costs 74 bytes and can declare 16000 x 16000
 * (256 megapixels), which is the whole attack: tiny file, enormous allocation.
 *
 * Set above the largest consumer camera sensor (~61 MP) so no real photograph is
 * ever refused, and far below `sharp`'s own 268-megapixel default.
 */
export const MAX_DECODE_PIXELS = 80_000_000;
/** At or below this, an image is soft enough to warn about (noticeably fuzzy in
 * print). Between this and the target is acceptable-but-not-ideal. */
export const PRINT_DPI_WARN_BELOW = 200;

/** 600 dpi across the largest card size we print — see MAX_ARTWORK_PIXELS. */
function maxPrintablePixels(): number {
  const dpi = PRINT_DPI_TARGET * 2;
  return Math.max(
    ...Object.values(CARD_SIZE_DIMENSIONS_MM).map(
      ({ widthMm, heightMm }) =>
        Math.ceil((widthMm / MM_PER_INCH) * dpi) * Math.ceil((heightMm / MM_PER_INCH) * dpi),
    ),
  );
}

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * A stored pixel size corrected for its EXIF orientation tag.
 *
 * A camera writes the sensor's own pixels and a tag saying which way up they
 * are. Browsers apply that tag when they decode; `sharp.metadata()` reports the
 * stored size and the tag separately and applies neither. So the same photo
 * measures 4000x3000 on one surface and 3000x4000 on another, and a rule built
 * on the wrong one refuses good artwork and passes bad.
 *
 * Orientations 5-8 carry a quarter turn, which is what swaps the axes; 1-4 are
 * identity, flips and a half turn, none of which change the dimensions.
 */
export function orientedPixelSize(stored: PixelSize, orientation?: number): PixelSize {
  return orientation !== undefined && orientation > 4
    ? { width: stored.height, height: stored.width }
    : stored;
}

export interface PrintedSizeMm {
  widthMm: number;
  heightMm: number;
}

/** Effective DPI of `naturalPx` source pixels printed across `printedMm`. Returns
 * 0 for a degenerate printed size. Pure. */
export function effectivePrintDpi(naturalPx: number, printedMm: number): number {
  if (printedMm <= 0 || naturalPx <= 0) return 0;
  return naturalPx / (printedMm / MM_PER_INCH);
}

/** The limiting (lower-axis) effective print DPI of an image at a printed size. */
export function imagePrintDpi(natural: PixelSize, printed: PrintedSizeMm): number {
  return Math.min(
    effectivePrintDpi(natural.width, printed.widthMm),
    effectivePrintDpi(natural.height, printed.heightMm),
  );
}

export type PrintDpiVerdict = "ok" | "acceptable" | "low";

/** Bucket a DPI into ok (≥ target) / acceptable (≥ warn) / low (< warn). Pure. */
export function printDpiVerdict(dpi: number): PrintDpiVerdict {
  if (dpi >= PRINT_DPI_TARGET) return "ok";
  if (dpi > PRINT_DPI_WARN_BELOW) return "acceptable";
  return "low";
}

/** Whether an image at this DPI should trigger a pre-flight warning. */
export function isLowPrintDpi(dpi: number): boolean {
  return printDpiVerdict(dpi) === "low";
}

/**
 * Millimetres per design unit at a card size — the design fills the **trim**
 * width, matching the print-ready PDF's geometry (`faceGeometry`).
 *
 * It does *not* match `fittedCardMm`, which this used to claim. That fits the
 * card into the printer safe area — 95mm of a 105mm A6 page — for the browser
 * print path, so the two differ by about 10%. Trim is the right basis here: it
 * is the larger of the two and therefore the more demanding resolution test, and
 * it is what the print house actually receives. See docs/card-artwork-crop-plan.md.
 */
function mmPerUnit(size: CardSize): number {
  return CARD_SIZE_DIMENSIONS_MM[size].widthMm / CARD_WIDTH;
}

/** The printed size of an image *element* (its design-unit box → millimetres). */
export function elementPrintedSizeMm(
  box: { width: number; height: number },
  size: CardSize,
): PrintedSizeMm {
  const perUnit = mmPerUnit(size);
  return { widthMm: box.width * perUnit, heightMm: box.height * perUnit };
}

/** The printed size of a page *background* — it covers the whole trimmed card. */
export function backgroundPrintedSizeMm(size: CardSize): PrintedSizeMm {
  const { widthMm, heightMm } = CARD_SIZE_DIMENSIONS_MM[size];
  return { widthMm, heightMm };
}

/** A raster image a design prints, with the physical size it prints at — the
 * input to a resolution pre-flight (the caller supplies each image's natural
 * pixel size). */
export interface PrintImageTarget {
  assetUrl: string;
  where: "background" | "element";
  printed: PrintedSizeMm;
}

/** An asset that is vector (SVG) has no fixed resolution, so it never triggers a
 * low-DPI warning. */
function isVectorAsset(assetUrl: string): boolean {
  return /\.svg(\?|#|$)/i.test(assetUrl);
}

/**
 * Every raster image a design prints (page background images + image elements),
 * paired with the physical size it prints at for the given card size. Vector
 * (SVG) assets are excluded. Pure — the caller measures each asset's natural
 * pixel size and applies {@link imagePrintDpi} / {@link isLowPrintDpi}.
 */
export function collectPrintImageTargets(
  document: DesignDocument,
  size: CardSize,
): PrintImageTarget[] {
  const targets: PrintImageTarget[] = [];
  for (const page of document.pages) {
    if (page.background?.type === "image" && !isVectorAsset(page.background.assetUrl)) {
      targets.push({
        assetUrl: page.background.assetUrl,
        where: "background",
        printed: backgroundPrintedSizeMm(size),
      });
    }
    for (const element of page.elements) {
      if (element.kind === "image" && !isVectorAsset(element.assetUrl)) {
        targets.push({
          assetUrl: element.assetUrl,
          where: "element",
          printed: elementPrintedSizeMm({ width: element.width, height: element.height }, size),
        });
      }
    }
  }
  return targets;
}
