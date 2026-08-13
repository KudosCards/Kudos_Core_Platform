/**
 * Print geometry for the server-side card→PDF renderer (docs/adr/0162).
 *
 * A card is authored in a fixed 450×634 design space (see design-layout.ts).
 * This module maps that space onto a real, print-house-ready page: the trimmed
 * A5/A6 size, plus 3 mm of bleed on every edge and registration (crop) marks —
 * so what the print house receives can be trimmed cleanly with no white slivers.
 *
 * The mapping mirrors the on-screen fit (card-format.ts `fittedCardMm`): the
 * design fills the trim width and is centred vertically (A6 matches the design
 * proportion almost exactly; A5 gets a hair of vertical centring, never
 * distortion). Everything here is pure and unit-tested — no pdfkit, no I/O.
 */

import { CARD_HEIGHT, CARD_WIDTH, CARD_SIZE_DIMENSIONS_MM, type CardSize } from "@kudos/shared-types";

/** PDF user-space units per millimetre (PDF points are 1/72 inch; 1in = 25.4mm). */
export const PT_PER_MM = 72 / 25.4;

/** Bleed added beyond the trim on every edge, in millimetres. 3 mm is the UK/EU
 * print-house standard for greeting cards. */
export const BLEED_MM = 3;

/** Crop-mark geometry, in millimetres: a small gap out from the trim corner
 * before a mark starts, then the mark's drawn length. The two sum to the bleed so
 * marks sit entirely within the bleed and finish exactly at the page edge. */
export const CROP_MARK_GAP_MM = 1;
export const CROP_MARK_LENGTH_MM = BLEED_MM - CROP_MARK_GAP_MM;
/** Hairline weight for crop marks, in points. */
export const CROP_MARK_WEIGHT_PT = 0.25;

export interface FaceGeometry {
  /** Full media box including bleed, in points. */
  pageWidthPt: number;
  pageHeightPt: number;
  /** The trimmed card box on the page, in points (what the cutter trims to). */
  trim: { xPt: number; yPt: number; widthPt: number; heightPt: number };
  /**
   * Transform from design units (0..450 × 0..634) to page points: translate the
   * origin to the design's top-left on the page, then scale uniformly. Applied as
   * `translate(translateXPt, translateYPt); scale(scalePtPerUnit)` so the renderer
   * can then draw every element in raw design units — exactly like Konva scales
   * its whole stage.
   */
  translateXPt: number;
  translateYPt: number;
  /** Points per design unit (uniform on both axes — never distorts). */
  scalePtPerUnit: number;
  bleedPt: number;
}

/**
 * Compute the page + transform for one card face at a given trim size. Pure.
 *
 * The design fills the trim width; its derived height is centred within the trim
 * height (offset ≈ 0 on A6, ~0.75 mm on A5). Bleed extends the page beyond the
 * trim on every edge; the design's *background* is drawn to the page edge (see
 * the renderer) so it bleeds, while elements stay within the trim to match the
 * editor's WYSIWYG stage exactly.
 */
export function faceGeometry(size: CardSize): FaceGeometry {
  const { widthMm: trimWidthMm, heightMm: trimHeightMm } = CARD_SIZE_DIMENSIONS_MM[size];

  // Uniform scale so 450 design units span the full trim width.
  const unitToMm = trimWidthMm / CARD_WIDTH;
  const designHeightMm = CARD_HEIGHT * unitToMm;
  // Centre the (never-taller-than-trim) design within the trim height.
  const verticalOffsetMm = Math.max(0, (trimHeightMm - designHeightMm) / 2);

  const pageWidthMm = trimWidthMm + 2 * BLEED_MM;
  const pageHeightMm = trimHeightMm + 2 * BLEED_MM;

  // Design top-left on the page: flush to the trim's left/top, plus the bleed
  // margin and the vertical centring offset.
  const designX0Mm = BLEED_MM;
  const designY0Mm = BLEED_MM + verticalOffsetMm;

  return {
    pageWidthPt: pageWidthMm * PT_PER_MM,
    pageHeightPt: pageHeightMm * PT_PER_MM,
    trim: {
      xPt: BLEED_MM * PT_PER_MM,
      yPt: BLEED_MM * PT_PER_MM,
      widthPt: trimWidthMm * PT_PER_MM,
      heightPt: trimHeightMm * PT_PER_MM,
    },
    translateXPt: designX0Mm * PT_PER_MM,
    translateYPt: designY0Mm * PT_PER_MM,
    scalePtPerUnit: unitToMm * PT_PER_MM,
    bleedPt: BLEED_MM * PT_PER_MM,
  };
}

export interface CropMarkLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The eight crop-mark line segments (two per trim corner) for a face, in page
 * points. Each corner gets one horizontal and one vertical mark sitting in the
 * bleed, starting `CROP_MARK_GAP_MM` out from the trim corner and running
 * `CROP_MARK_LENGTH_MM` to the page edge. Pure.
 */
export function cropMarks(geometry: FaceGeometry): CropMarkLine[] {
  const { trim } = geometry;
  const gap = CROP_MARK_GAP_MM * PT_PER_MM;
  const len = CROP_MARK_LENGTH_MM * PT_PER_MM;
  const left = trim.xPt;
  const right = trim.xPt + trim.widthPt;
  const top = trim.yPt;
  const bottom = trim.yPt + trim.heightPt;

  const marks: CropMarkLine[] = [];
  // For each corner: sx/sy are the outward directions (into the bleed).
  const corners: { cx: number; cy: number; sx: number; sy: number }[] = [
    { cx: left, cy: top, sx: -1, sy: -1 },
    { cx: right, cy: top, sx: 1, sy: -1 },
    { cx: left, cy: bottom, sx: -1, sy: 1 },
    { cx: right, cy: bottom, sx: 1, sy: 1 },
  ];
  for (const { cx, cy, sx, sy } of corners) {
    // Vertical mark: outward from the corner along y.
    marks.push({ x1: cx, y1: cy + sy * gap, x2: cx, y2: cy + sy * (gap + len) });
    // Horizontal mark: outward from the corner along x.
    marks.push({ x1: cx + sx * gap, y1: cy, x2: cx + sx * (gap + len), y2: cy });
  }
  return marks;
}
