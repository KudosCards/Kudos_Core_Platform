/**
 * The shape of the sheet the printer actually takes, and the one number that
 * makes borderless printing land where it should.
 *
 * A Kudos card is A6 and folded, and the house printer (a Canon imagePROGRAF
 * PRO-310) has no borderless A6. So a card face cannot be a page: the page has
 * to be the **A5 landscape sheet** that folds to one A6 card, carrying two faces
 * side by side with the fold down the middle. See
 * docs/card-print-quality-plan.md (D1–D3).
 *
 * Everything here is pure arithmetic and shared, so the engine, the admin panel
 * and the tests cannot disagree about what a sheet is.
 */

import { z } from "zod";
import { CARD_SIZE_DIMENSIONS_MM, type CardSize } from "./card-format";

/**
 * The sheet that folds to one card of `size`: two panels side by side, same
 * height. A6 gives 210 × 148 mm — A5 landscape, the stock Kudos prints on.
 *
 * Derived rather than hard-coded so the relationship stays true if the house
 * size ever changes: an A5 card would fold from a 296 × 210 mm sheet (A4
 * landscape, near enough to trim from).
 */
export function foldedSheetMm(size: CardSize): { widthMm: number; heightMm: number } {
  const { widthMm, heightMm } = CARD_SIZE_DIMENSIONS_MM[size];
  return { widthMm: widthMm * 2, heightMm };
}

/**
 * The largest overhang we will accept from the calibration sheet. Real drivers
 * enlarge by 1–3 mm per edge; anything beyond this is a mis-read or a typo, and
 * accepting it would shrink the card visibly for every customer.
 */
export const MAX_BORDERLESS_OVERHANG_MM = 10;

/**
 * How much overhang the compensation deliberately leaves behind.
 *
 * Compensating a measured overhang *exactly* makes the card fill the paper
 * exactly — and a sheet-fed printer does not place every sheet identically. The
 * first calibration print was 1.75 mm off centre, so the feed clearly moves;
 * correcting to zero would turn any variation into a white sliver down one edge
 * of a finished card, which is worse than losing a millimetre of background.
 *
 * So the card is drawn to overrun the paper by about this much, and that much
 * background is thrown away on purpose. It is a judgement, not a measurement:
 * one sheet says where the feed sat, not how far it wanders. Several prints
 * would say, and this is the number to revisit when they exist.
 */
export const BORDERLESS_SAFETY_MM = 1;

/** How a print run is laid out on paper. */
export const PRINT_LAYOUTS = ["folded-sheet", "face-per-page"] as const;
export type PrintLayout = (typeof PRINT_LAYOUTS)[number];

/**
 * Where the strip across the bottom of the card's back comes from.
 *
 * `reserved` is the stock Kudos buys today: the Kudos mark and the QR caption
 * are already printed on it, so the engine only keeps customer artwork out of
 * the strip. `print` is for blank stock — the engine draws the band, this card's
 * QR, the caption and the mark itself.
 *
 * Getting this wrong is visible on every card: `print` on pre-printed stock
 * overprints the branding, `reserved` on blank stock posts a card with an empty
 * white strip and no QR at all. It changes when the stock changes, which is why
 * it belongs to the printer profile and not to a run.
 */
export const BACK_FOOTER_MODES = ["reserved", "print"] as const;
export type BackFooterMode = (typeof BACK_FOOTER_MODES)[number];

export interface PrintProfile {
  /**
   * `folded-sheet` is what this printer needs and is the default. `face-per-page`
   * is the old one-face-per-page output, kept as the escape hatch: if a sheet
   * ever comes out wrong at the printer, ops can fall back without a deploy.
   */
  layout: PrintLayout;
  /**
   * The long-edge loss, in millimetres, measured off the borderless calibration
   * sheet. **0 means "not measured yet"** — and 0 is also exactly right for a
   * printer that is not enlarging at all, so it is a safe default either way.
   */
  borderlessOverhangMm: number;
  /**
   * How far the printer places the sheet off centre, in mm, along the sheet's
   * **long** axis: `(left − right) ÷ 2` of the four calibration readings.
   * Negative means it prints too far right, so the card is drawn further left.
   *
   * Separate from the overhang because it is a different fault with a different
   * fix. The overhang is the driver enlarging the page, which a scale corrects.
   * This is the paper arriving somewhere other than where the driver thinks,
   * which no amount of scaling corrects — it has to be moved. ADR 0249 recorded
   * that the compensation assumed these were the same thing; the first
   * calibration print that engaged borderless proved they are not.
   */
  borderlessOffsetXMm: number;
  /** The same along the short axis: `(top − bottom) ÷ 2`. Negative moves the
   *  card up. Zero on the calibration print that produced these fields. */
  borderlessOffsetYMm: number;
  /** Whether the back's bottom strip is already on the stock or drawn here. */
  backFooter: BackFooterMode;
}

/** What the engine uses until a super admin has entered a measured figure. */
export const DEFAULT_PRINT_PROFILE: PrintProfile = {
  layout: "folded-sheet",
  borderlessOverhangMm: 0,
  borderlessOffsetXMm: 0,
  borderlessOffsetYMm: 0,
  // The stock in the building is pre-printed, so the safe default is to leave
  // the strip alone. Switched to "print" when blank stock arrives — after a
  // proof, not before.
  backFooter: "reserved",
};

/** A placement offset: either direction, and no finer than a ruler can read. */
const offsetMm = z
  .number()
  .finite()
  .min(-MAX_BORDERLESS_OVERHANG_MM)
  .max(MAX_BORDERLESS_OVERHANG_MM)
  .transform((mm) => Math.round(mm * 4) / 4);

export const printProfileSchema = z.object({
  layout: z.enum(PRINT_LAYOUTS),
  borderlessOverhangMm: z
    .number()
    .finite()
    .min(0)
    .max(MAX_BORDERLESS_OVERHANG_MM)
    // Quarter-millimetre is finer than anyone can read off a printed ruler;
    // rounding here keeps a stored 2.8571428 out of the geometry.
    .transform((mm) => Math.round(mm * 4) / 4),
  borderlessOffsetXMm: offsetMm,
  borderlessOffsetYMm: offsetMm,
  backFooter: z.enum(BACK_FOOTER_MODES),
});

/**
 * The factor the sheet's contents must be scaled by, about the sheet's centre,
 * so that the card's trim lands on the paper edge after the driver's borderless
 * enlargement.
 *
 * A borderless driver prints by *enlarging*: it scales the page until it
 * overhangs the paper by `overhangMm` on the long edges and lets the surplus
 * fall off. Adding bleed cannot help, because content outside the page box never
 * reaches the driver at all. The only thing that can help is drawing the card
 * fractionally smaller, so the enlargement brings it back to exactly full size.
 *
 * With sheet width `W` the driver's enlargement is `s = (W + 2·overhang) / W`,
 * so the compensation is `1/s`. Applying it about the centre gets both axes
 * right at once: the enlargement is uniform, so the short edge loses
 * proportionally less, and a centred scale reproduces that automatically.
 *
 * At `overhangMm = 0` this returns exactly 1 and the sheet is drawn full size —
 * the correct output for a printer that is not enlarging.
 */
export function borderlessShrink(overhangMm: number, sheetWidthMm: number): number {
  // Defensive: a negative or absurd figure would *grow* the card past the sheet
  // and push the far panel off the page. Neither is a thing a ruler can show.
  const overhang = Math.min(Math.max(0, overhangMm), MAX_BORDERLESS_OVERHANG_MM);
  if (!(sheetWidthMm > 0)) return 1;

  // Corrected down to a deliberate residual, not to zero — see
  // `BORDERLESS_SAFETY_MM`. A measured overhang at or below the safety band is
  // already as small as we would aim for, so it is left alone entirely.
  const correcting = Math.max(0, overhang - BORDERLESS_SAFETY_MM);
  return sheetWidthMm / (sheetWidthMm + 2 * correcting);
}

/**
 * How far the sheet's contents move, in mm of **page** space, to put a card the
 * printer is placing off centre back in the middle.
 *
 * Scaled by the shrink because the driver enlarges whatever we draw: a shift of
 * `d` on the page becomes `d ÷ shrink` on the paper. Getting this wrong is a
 * 3% error on a 1.75 mm correction — under a tenth of a millimetre, and still
 * not a reason to write it down wrong.
 *
 * The sign is the stored offset's: `(left − right) ÷ 2` is negative when the
 * printer runs right, and a negative shift moves the card left.
 */
export function borderlessShiftMm(offsetMm: number, shrink: number): number {
  if (!Number.isFinite(offsetMm)) return 0;
  const offset = Math.min(
    Math.max(-MAX_BORDERLESS_OVERHANG_MM, offsetMm),
    MAX_BORDERLESS_OVERHANG_MM,
  );
  return offset * shrink;
}
