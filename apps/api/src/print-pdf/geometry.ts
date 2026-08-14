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

/** Nominal gap (mm) out from the trim corner before a crop mark starts. The
 * mark's length is derived from the *actual* bleed (see {@link cropMarks}) so the
 * mark always sits within the bleed and finishes exactly at the page edge — for
 * whatever `bleedMm` the page was built with, not just the 3 mm default. */
export const CROP_MARK_GAP_MM = 1;
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
 * height (offset ≈ 0 on A6, ~0.75 mm on A5). `bleedMm` extends the page beyond
 * the trim on every edge; the design's *background* is drawn to the page edge
 * (see the renderer) so it bleeds, while elements stay within the trim to match
 * the editor's WYSIWYG stage exactly.
 *
 * `bleedMm` defaults to {@link BLEED_MM} (the print-house standard). Pass `0` to
 * produce a page at the exact trim size — the right output when the card is
 * printed and folded rather than trimmed, so there's no bleed margin to remove
 * (and, paired with `cropMarks: false`, no cut marks). See docs/adr/0162.
 */
export function faceGeometry(size: CardSize, bleedMmArg: number = BLEED_MM): FaceGeometry {
  // Never let a negative bleed shrink the page below the trim (which would push
  // the trim/design origin off the media box). Defensive — callers pass 0 or 3.
  const bleedMm = Math.max(0, bleedMmArg);
  const { widthMm: trimWidthMm, heightMm: trimHeightMm } = CARD_SIZE_DIMENSIONS_MM[size];

  // Uniform scale so 450 design units span the full trim width.
  const unitToMm = trimWidthMm / CARD_WIDTH;
  const designHeightMm = CARD_HEIGHT * unitToMm;
  // Centre the (never-taller-than-trim) design within the trim height.
  const verticalOffsetMm = Math.max(0, (trimHeightMm - designHeightMm) / 2);

  const pageWidthMm = trimWidthMm + 2 * bleedMm;
  const pageHeightMm = trimHeightMm + 2 * bleedMm;

  // Design top-left on the page: flush to the trim's left/top, plus the bleed
  // margin and the vertical centring offset.
  const designX0Mm = bleedMm;
  const designY0Mm = bleedMm + verticalOffsetMm;

  return {
    pageWidthPt: pageWidthMm * PT_PER_MM,
    pageHeightPt: pageHeightMm * PT_PER_MM,
    trim: {
      xPt: bleedMm * PT_PER_MM,
      yPt: bleedMm * PT_PER_MM,
      widthPt: trimWidthMm * PT_PER_MM,
      heightPt: trimHeightMm * PT_PER_MM,
    },
    translateXPt: designX0Mm * PT_PER_MM,
    translateYPt: designY0Mm * PT_PER_MM,
    scalePtPerUnit: unitToMm * PT_PER_MM,
    bleedPt: bleedMm * PT_PER_MM,
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
 * bleed, starting a small gap out from the trim corner and running to the page
 * edge. The gap + length are derived from the page's *actual* `bleedPt` (not the
 * default constant), so marks finish exactly at the edge for any bleed. A page
 * with no bleed yields zero-length marks — callers pass `cropMarks: false` there.
 * Pure.
 */
export function cropMarks(geometry: FaceGeometry): CropMarkLine[] {
  const { trim, bleedPt } = geometry;
  // Keep the nominal 1 mm gap, but never let it exceed the bleed (cap at a third
  // so a mark always has room); the mark then runs from the gap out to the edge.
  const gap = Math.min(CROP_MARK_GAP_MM * PT_PER_MM, bleedPt / 3);
  const len = Math.max(0, bleedPt - gap);
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
