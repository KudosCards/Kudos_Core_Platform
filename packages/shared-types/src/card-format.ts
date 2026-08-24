/**
 * The physical formats we print cards at. We stock two ISO A sizes — A6 and A5 —
 * which share the same 1:√2 proportion, so a single design prints at either size
 * just by scaling. This module is the one source of truth for those sizes, their
 * millimetre dimensions, the print-fit geometry, and the customer-facing copy.
 *
 * The size a given print run uses is chosen by the ops team per run, defaulting
 * to a super-admin-configured default (see docs/adr/0138). Customers don't pick
 * a size, so the customer-facing copy below states the current default.
 */

import { z } from "zod";
import { CARD_HEIGHT, CARD_WIDTH } from "./design-layout";

/** The paper sizes we can print, as short codes. Order is the UI order. */
export const CARD_SIZES = ["A6", "A5"] as const;
export type CardSize = (typeof CARD_SIZES)[number];

/** Zod enum for validating a size code coming off the wire (admin setting, DTO). */
export const cardSizeSchema = z.enum(CARD_SIZES);

/** The size a print run uses when nothing else is chosen. A6 is our house size. */
export const DEFAULT_CARD_SIZE: CardSize = "A6";

/** Trimmed dimensions per size, portrait, in millimetres (the ISO A series). */
export const CARD_SIZE_DIMENSIONS_MM: Record<CardSize, { widthMm: number; heightMm: number }> = {
  A6: { widthMm: 105, heightMm: 148 },
  A5: { widthMm: 148, heightMm: 210 },
};

/** Millimetres per CSS inch — browsers lay out CSS at 96dpi, so 1in = 96px. */
const CSS_DPI = 96;
const MM_PER_INCH = 25.4;

/**
 * Convert millimetres to CSS pixels at the print/paged-media reference of 96dpi.
 * A box sized this many CSS px prints at exactly `mm` millimetres, which is how
 * the print overlay renders a card face at a true physical size. Pure.
 */
export function mmToCssPx(mm: number): number {
  return (mm * CSS_DPI) / MM_PER_INCH;
}

/** "105 × 148 mm" — the size's dimensions, for labels. */
export function cardSizeDimensions(size: CardSize): string {
  const { widthMm, heightMm } = CARD_SIZE_DIMENSIONS_MM[size];
  return `${widthMm} × ${heightMm} mm`;
}

/** "A6 (105 × 148 mm)" — the size named with its dimensions, for labels. */
export function cardSizeLabel(size: CardSize): string {
  return `${size} (${cardSizeDimensions(size)})`;
}

/** How far in from every trimmed edge a card is kept on the printed page, so the
 * artwork isn't lost to a home/office printer's unprintable margin. Millimetres. */
export const PRINT_SAFE_MARGIN_MM = 5;

/** A card face fitted onto a physical page: the page's size and the centred card
 * box, both in millimetres. */
export interface FittedCardMm {
  pageWidthMm: number;
  pageHeightMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
}

/**
 * Fit the authored card face (CARD_WIDTH × CARD_HEIGHT design units) onto a
 * physical A-size page, centred, keeping its aspect ratio (never distorted) and
 * staying `marginMm` in from every edge. The design space is proportioned to A6
 * (105×148 mm), so on the house size the fitted card very nearly fills the safe
 * area with no vertical letterbox — the editor is WYSIWYG against print. We
 * still clamp on both width and height so the maths stays correct for any size
 * (e.g. A5, whose proportion differs by a hair). Pure, so it can be unit-tested
 * and shared by screen preview and print.
 */
export function fittedCardMm(
  size: CardSize,
  marginMm: number = PRINT_SAFE_MARGIN_MM,
): FittedCardMm {
  const { widthMm: pageWidthMm, heightMm: pageHeightMm } = CARD_SIZE_DIMENSIONS_MM[size];
  const availWidthMm = Math.max(0, pageWidthMm - 2 * marginMm);
  const availHeightMm = Math.max(0, pageHeightMm - 2 * marginMm);
  const aspect = CARD_HEIGHT / CARD_WIDTH; // height per unit width (≈1.409 for 450×634, i.e. A6)
  // Widest the card can be while its derived height still fits the available box.
  const cardWidthMm = Math.min(availWidthMm, availHeightMm / aspect);
  return {
    pageWidthMm,
    pageHeightMm,
    cardWidthMm,
    cardHeightMm: cardWidthMm * aspect,
  };
}

/**
 * How much of the back of a card is ours, in millimetres, measured up from the
 * bottom trim edge.
 *
 * Cards are printed on stock whose back already carries the Kudos logo and QR
 * code in a strip along the bottom. Nothing in the software knew that, so the
 * back was simply a fourth editable face and whatever a customer put there was
 * sent to print — over branding that is physically already on the card. One
 * customer filled it with a grid of partner adverts.
 *
 * Measured from the trim edge rather than from the printer safe area on
 * purpose. It is the rule that is simplest to state to a customer ("the bottom
 * 30mm is ours"), and it can only ever over-reserve: the alternative leaves a
 * thin strip below the band where content would print into the branding.
 */
export const BACK_RESERVED_FOOTER_MM = 30;

/**
 * The reserved footer's height in design units for a given card size.
 *
 * Derived rather than hardcoded because the authoring canvas is one fixed
 * CARD_WIDTH × CARD_HEIGHT space *fitted* onto whatever card is printed — so a
 * fixed number of units is a fixed *fraction* of the card, which is a different
 * number of millimetres at each size. 30mm is a physical property of the stock,
 * so it has to be converted per size: ~128.5 units on A6, ~90.6 on A5.
 */
export function backReservedFooterUnits(size: CardSize = DEFAULT_CARD_SIZE): number {
  const { heightMm } = CARD_SIZE_DIMENSIONS_MM[size];
  return (BACK_RESERVED_FOOTER_MM * CARD_HEIGHT) / heightMm;
}

/** The y coordinate where the reserved footer begins — content must stay above
 *  it. Pure, and shared by the editor guide and the print clip so they cannot
 *  disagree about where the band is. */
export function backReservedFooterTop(size: CardSize = DEFAULT_CARD_SIZE): number {
  return CARD_HEIGHT - backReservedFooterUnits(size);
}

/**
 * Whether an element's box reaches into the reserved footer on the back face.
 *
 * Only ever asked of the back — the other three faces are entirely the
 * customer's. `width`/`height` are the rendered box, as `isOutsideSafeArea`
 * takes them.
 */
export function isInBackReservedFooter(
  box: { y: number; height: number },
  size: CardSize = DEFAULT_CARD_SIZE,
): boolean {
  return box.y + box.height > backReservedFooterTop(size);
}

// --- Backward-compatible single-size exports -------------------------------
// The customer-facing surfaces (card library, card preview, checkout summary)
// state the size everyone gets. They're bound to the default size so existing
// copy stays correct without each call site learning about multiple sizes.

/** The default paper size we print, as a short code. */
export const CARD_SIZE_CODE = DEFAULT_CARD_SIZE;

/** The default size's trimmed dimensions, portrait, in millimetres. */
export const CARD_SIZE_DIMENSIONS = cardSizeDimensions(DEFAULT_CARD_SIZE);

/** "A6 (105 × 148 mm)" — the default size named with its dimensions, for labels. */
export const CARD_SIZE_LABEL = cardSizeLabel(DEFAULT_CARD_SIZE);

/**
 * The one-line notice shown wherever a customer chooses or buys a card, so
 * everyone knows the size before they pay. Rendered identically across the card
 * library, the card preview and every checkout summary.
 */
export const CARD_SIZE_NOTICE = `All cards are printed ${CARD_SIZE_LABEL}.`;
