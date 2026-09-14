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

import { CARD_HEIGHT, CARD_WIDTH } from "./design-layout";
// The same "an image's natural size" the resolution pre-flight uses. One
// definition, so a caller can hand the same measurement to both questions.
import type { PixelSize } from "./print-quality";

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
