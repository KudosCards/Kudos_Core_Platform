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
  /** Whether the back's bottom strip is already on the stock or drawn here. */
  backFooter: BackFooterMode;
}

/** What the engine uses until a super admin has entered a measured figure. */
export const DEFAULT_PRINT_PROFILE: PrintProfile = {
  layout: "folded-sheet",
  borderlessOverhangMm: 0,
  // The stock in the building is pre-printed, so the safe default is to leave
  // the strip alone. Switched to "print" when blank stock arrives — after a
  // proof, not before.
  backFooter: "reserved",
};

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
  return sheetWidthMm / (sheetWidthMm + 2 * overhang);
}
