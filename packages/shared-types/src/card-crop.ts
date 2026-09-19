/**
 * How much of a piece of artwork we throw away to make it fit a card.
 *
 * A page background is drawn full-bleed and centre-cropped to the card's own
 * proportion (see `coverCrop`), which is correct and undistorted — and silent.
 * A square source, the default output of most illustration tools, loses 14.5%
 * off each side: 29% of its width, gone, with nothing anywhere in the product
 * saying so. The pre-flight beside this one reports an image that is too *soft*
 * to print and stays quiet while a third of it is discarded.
 *
 * Separate from `print-quality.ts` on purpose. Resolution and crop are two
 * different questions about the same image — "are there enough pixels" and "is
 * the shape right" — and folding the second into the module whose whole subject
 * is effective DPI would make both harder to read. The overlay asks both.
 *
 * Pure: callers supply the natural pixel size (from a loaded image or `sharp`
 * metadata) and the box it is being fitted into. Nothing here does I/O.
 *
 * See docs/card-artwork-crop-plan.md.
 */

import { CARD_SIZE_DIMENSIONS_MM, CARD_SIZES, type CardSize } from "./card-format";
import { CARD_HEIGHT, CARD_WIDTH, coverCrop } from "./design-layout";

// The same "an image's natural size" the resolution pre-flight uses. One
// definition, so a caller can hand the same measurement to both questions.
import { PRINT_DPI_TARGET, type PixelSize } from "./print-quality";

export type { PixelSize };

/**
 * The fraction of each axis discarded by a cover-crop, 0..1.
 *
 * A cover-crop only ever trims one axis — the one the source has too much of —
 * so at most one of these is non-zero. Measured as the **total** fraction of
 * that axis removed, not the fraction per side: 29% for a square source means
 * 29% of its width is not on the card, which is the number worth saying out
 * loud. (It is taken off in two 14.5% slices, one per edge, because the crop is
 * centred.)
 */
export interface CropLoss {
  widthLost: number;
  heightLost: number;
}

/**
 * What a cover-crop of `natural` into `box` throws away. Pure.
 *
 * Mirrors `coverCrop` exactly — same comparison, same direction — because a
 * measurement that disagreed with the crop it describes would be worse than no
 * measurement. A degenerate input loses nothing, rather than dividing by zero.
 */
export function coverCropLoss(natural: PixelSize, box: PixelSize): CropLoss {
  if (natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { widthLost: 0, heightLost: 0 };
  }
  const boxRatio = box.width / box.height;
  const imgRatio = natural.width / natural.height;

  if (imgRatio > boxRatio) {
    // Wider than the box: the sides are trimmed, the full height survives.
    const keptWidth = natural.height * boxRatio;
    return { widthLost: (natural.width - keptWidth) / natural.width, heightLost: 0 };
  }
  // Taller than (or exactly) the box: top and bottom are trimmed.
  const keptHeight = natural.width / boxRatio;
  return { widthLost: 0, heightLost: (natural.height - keptHeight) / natural.height };
}

/** The loss of a background image, which fills the whole authored card face. */
export function backgroundCropLoss(natural: PixelSize): CropLoss {
  return coverCropLoss(natural, { width: CARD_WIDTH, height: CARD_HEIGHT });
}

export type CropVerdict = "ok" | "noticeable" | "heavy";

/**
 * At or below this fraction of an axis, a crop is not worth mentioning.
 *
 * A card is 1:1.409 and almost nothing is authored at exactly that, so a rule
 * with no floor would flag every image on the platform.
 */
export const CROP_OK_BELOW = 0.02;

/**
 * Above this, the composition is being cut rather than tidied.
 *
 * 10% of an axis is 10.5mm off an A6 card — a border gone, a character's arm
 * gone, a line of a signature gone. Chosen to put 3:4 (5.4%) in the middle and
 * 4:5 (11.2%) and square (29%) plainly over the line, which is where looking at
 * real artwork puts them. A starting position with a test pinning it, not a law.
 */
export const CROP_HEAVY_ABOVE = 0.1;

/** Bucket a crop loss into ok / noticeable / heavy, on its worst axis. Pure. */
export function cropVerdict(loss: CropLoss): CropVerdict {
  const worst = Math.max(loss.widthLost, loss.heightLost);
  if (worst <= CROP_OK_BELOW) return "ok";
  if (worst <= CROP_HEAVY_ABOVE) return "noticeable";
  return "heavy";
}

/** The worst axis's loss as a whole-number percentage, for a message a person
 *  reads ("29% of this artwork's width is not printed"). Pure. */
export function cropLossPercent(loss: CropLoss): number {
  return Math.round(Math.max(loss.widthLost, loss.heightLost) * 100);
}

/** Which axis the crop takes from, or null when nothing is lost — so a message
 *  can say "width" or "height" rather than guessing. Pure. */
export function croppedAxis(loss: CropLoss): "width" | "height" | null {
  if (loss.widthLost <= 0 && loss.heightLost <= 0) return null;
  return loss.widthLost >= loss.heightLost ? "width" : "height";
}

/** A rectangle in the coordinate space of the box being drawn into. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where to draw the whole of a piece of artwork inside `box`, and which part of
 * that drawing actually reaches the card.
 *
 * A cropped render is the one view guaranteed not to contain the answer to
 * "does the discarded 4.46mm matter on this card?" — the part in question is
 * the part that is gone. So the reveal contains the source rather than covering
 * it: the whole image, shrunk to fit, with the printed rectangle marked inside
 * it. `printed` is exactly `coverCrop` mapped into that drawing, so the band a
 * person sees and the percentage they are told come from the same arithmetic.
 *
 * Both rectangles are uniformly scaled from the source, so the card's own
 * content can be drawn into `printed` without distorting.
 *
 * See docs/card-artwork-shape-plan.md, Phase 1.
 */
export interface RevealedCrop {
  /** The full source, fitted inside the box and centred. */
  drawn: CropRect;
  /** The sub-rectangle of `drawn` that survives the crop and prints. */
  printed: CropRect;
}

const EMPTY_RECT: CropRect = { x: 0, y: 0, width: 0, height: 0 };

/** Pure. A degenerate size draws nothing rather than dividing by zero. */
export function revealedCrop(natural: PixelSize, box: PixelSize): RevealedCrop {
  if (natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { drawn: { ...EMPTY_RECT }, printed: { ...EMPTY_RECT } };
  }
  // Contain, not cover: the whole source has to be visible, which is the entire
  // point of the view.
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const drawn: CropRect = {
    x: (box.width - natural.width * scale) / 2,
    y: (box.height - natural.height * scale) / 2,
    width: natural.width * scale,
    height: natural.height * scale,
  };
  const crop = coverCrop(natural, box);
  return {
    drawn,
    printed: {
      x: drawn.x + crop.x * scale,
      y: drawn.y + crop.y * scale,
      width: crop.width * scale,
      height: crop.height * scale,
    },
  };
}

const MM_PER_INCH = 25.4;

/**
 * The crop as millimetres off **each** edge of a printed card. Pure.
 *
 * "6% of the height" is true and almost useless: nobody briefs a designer in
 * percentages of an axis, and nobody can picture one. "4.5mm off the top and
 * the bottom" is the same fact in a form a person can hold a ruler against.
 *
 * Halved, because a cover-crop is centred and takes from both edges — and
 * measured against the axis actually being trimmed, since a card is 105mm one
 * way and 148mm the other.
 */
export function cropLossPerEdgeMm(loss: CropLoss, size: CardSize): number {
  const { widthMm, heightMm } = CARD_SIZE_DIMENSIONS_MM[size];
  const axis = croppedAxis(loss);
  if (axis === null) return 0;
  const alongMm = axis === "width" ? widthMm : heightMm;
  const fraction = axis === "width" ? loss.widthLost : loss.heightLost;
  return (alongMm * fraction) / 2;
}

/**
 * The pixel size artwork should be authored at: the card's own proportion, at
 * the print target. Pure.
 *
 * The one number to give whoever produces the artwork. It has to answer both
 * pre-flights at once — the right shape so nothing is cropped, and enough
 * pixels so nothing is soft — because an export that fixes one while breaking
 * the other just moves the complaint. A6 comes out at 1240 x 1748.
 */
export function idealArtworkPixels(size: CardSize): PixelSize {
  const { widthMm, heightMm } = CARD_SIZE_DIMENSIONS_MM[size];
  const px = (mm: number) => Math.round((mm / MM_PER_INCH) * PRINT_DPI_TARGET);
  // From the paper, not the authored canvas. The canvas is 450 x 634 while
  // 450 x 148/105 is 634.29, so deriving from it would give 1240 x 1747 — a
  // number no design tool produces, that a supplier would reasonably "correct"
  // to 1748, and that is odd enough to invite a query every time it is read.
  // 1240 x 1748 is A6 at 300dpi exactly; against our canvas it loses 0.06% of
  // its height, which the floor forgives (see the true-A6 case above).
  return { width: px(widthMm), height: px(heightMm) };
}

/** The largest size we stock, by area. Derived rather than named, so adding a
 *  size to CARD_SIZES is the whole change. */
function largestCardSize(): CardSize {
  const area = (size: CardSize): number => {
    const { widthMm, heightMm } = CARD_SIZE_DIMENSIONS_MM[size];
    return widthMm * heightMm;
  };
  return CARD_SIZES.reduce((largest, size) => (area(size) > area(largest) ? size : largest));
}

/**
 * The size to author a **catalog master** at: one export that serves every size
 * we print. Pure.
 *
 * `idealArtworkPixels` answers a different question — what is exactly right for
 * *this* card. A catalog design is not authored per size; it is exported once
 * and printed at whichever size the run chooses. So the number to hand whoever
 * produces the artwork is the one that is 300 dpi on the **largest** size we
 * stock. A6's ideal is 1240 x 1748, which is only 213 dpi on A5 — a library
 * exported to it needs doing again the day an A5 card is sold. A5's is
 * 1748 x 2480, which is 300 dpi on both.
 *
 * It is not the exact shape of an A6 card: 0.70% of its height is cropped,
 * against 0.06% for the A6 figure. Both sit well inside `CROP_OK_BELOW`, so
 * either clears the gate — which is why this can be one number rather than a
 * choice. See docs/ops/catalog-re-export.md.
 */
export function masterArtworkPixels(): PixelSize {
  return idealArtworkPixels(largestCardSize());
}

/**
 * Bleed on the PDF the ops print run produces, in millimetres.
 *
 * Zero: Kudos prints and folds these cards rather than trimming them, so the
 * page is the exact trim size (see ADR 0162 and print-run-pdf.service.ts).
 *
 * Shared rather than a literal at the call site because the measurement below
 * has to describe the geometry the renderer actually uses. `renderPdf` still
 * defaults to 3mm for a future print house that trims, and the day one is
 * wired up this constant is what keeps every reported number honest.
 */
export const PRINT_RUN_BLEED_MM = 0;

/** Which output a crop is being measured for. Required, not defaulted: the
 *  answer differs by a factor of two between bleed and no bleed, so a caller
 *  has to say which one it means. */
export interface PrintedGeometry {
  size: CardSize;
  bleedMm: number;
}

/**
 * What a background loses on a **finished, trimmed** card. Pure.
 *
 * Two things take from it, and only the first exists at `bleedMm: 0`:
 *
 * 1. the cover-crop, which fits the artwork over the whole page; and
 * 2. the trim, which cuts the page back to the card.
 *
 * `backgroundCropLoss` models neither — it fits to the authored 450x634 canvas,
 * which coincides with the trim to within 0.06mm and is the right answer for
 * what is drawn on screen. It is the wrong answer for a page with bleed: there
 * the background is scaled to fill 111x154 and then cut back to 105x148, so a
 * 2:3 source loses 11.1% of its height and 5.4% of its width rather than 6% and
 * nothing. Reporting the canvas figure for that page would understate the loss
 * by half. See docs/card-artwork-shape-plan.md, D5.
 */
export function printedCropLoss(natural: PixelSize, geometry: PrintedGeometry): CropLoss {
  const { widthMm, heightMm } = CARD_SIZE_DIMENSIONS_MM[geometry.size];
  const bleedMm = Math.max(0, geometry.bleedMm);
  const page = { width: widthMm + 2 * bleedMm, height: heightMm + 2 * bleedMm };

  const onPage = coverCropLoss(natural, page);
  // With no bleed the page *is* the trim: there is no second cut, and applying
  // one anyway would multiply by an exact 1 and cost precision for nothing.
  if (bleedMm === 0) return onPage;

  // Whatever survived the crop, minus what the guillotine then takes.
  const kept = (lost: number, trimMm: number, pageMm: number) => (1 - lost) * (trimMm / pageMm);
  return {
    widthLost: 1 - kept(onPage.widthLost, widthMm, page.width),
    heightLost: 1 - kept(onPage.heightLost, heightMm, page.height),
  };
}
