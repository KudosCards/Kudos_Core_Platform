/**
 * The layout of the strip across the bottom of a card's back.
 *
 * Today that strip is pre-printed on the stock and the renderer simply keeps
 * customer content out of it (`backReservedFooterTop`). Printing in-house on
 * blank stock means drawing it instead — the QR that leads to this card's
 * message page, the caption that tells the recipient what it is, and the Kudos
 * mark. This module is where the two agree on what goes where, in the same
 * 450 × 634 design units every other card surface uses, so it can be checked
 * without a PDF. See docs/card-print-quality-plan.md (P4).
 */

import { CARD_HEIGHT, CARD_WIDTH } from "./design-layout";
import { backReservedFooterTop, DEFAULT_CARD_SIZE, type CardSize } from "./card-format";

/** What the recipient is told the QR is for. Only ever drawn beside a real QR. */
export const BACK_FOOTER_CAPTION = "Scan to see your message";

/** Aspect of the Kudos wordmark (`apps/web/public/marketing/logo.png`). */
const LOGO_ASPECT = 410 / 475;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BackFooterLayout {
  /** The whole strip, drawn white so artwork above it never bleeds in. */
  band: Box;
  /** The QR, square. Null when this card has no message page. */
  qr: Box | null;
  /** The caption box, to be vertically centred within. Null when there is no QR
   * — the words are meaningless without one, and a caption beside nothing reads
   * as a printing fault. */
  caption: (Box & { fontSize: number }) | null;
  /** The Kudos mark. Right-aligned beside a QR, centred when it is alone. */
  logo: Box;
}

/**
 * Where each piece of the printed back footer sits, in design units.
 *
 * `hasQr` is the card's own answer — a card with no message page gets a plain
 * white band with the mark on it, never a placeholder square beside "Scan to see
 * your message", which is the one thing on a finished card nobody could act on.
 *
 * Pure; every measurement is derived from the band's own height so the strip
 * keeps its proportions at either card size.
 */
export function backFooterLayout(
  size: CardSize = DEFAULT_CARD_SIZE,
  hasQr: boolean,
): BackFooterLayout {
  const top = backReservedFooterTop(size);
  const height = Math.max(0, CARD_HEIGHT - top);
  const band: Box = { x: 0, y: top, width: CARD_WIDTH, height };

  const pad = height * 0.125;
  const inner = Math.max(0, height - 2 * pad);
  const gap = pad * 0.75;
  const contentY = top + pad;

  const logoHeight = inner;
  const logoWidth = logoHeight * LOGO_ASPECT;

  if (!hasQr) {
    return {
      band,
      qr: null,
      caption: null,
      logo: {
        x: (CARD_WIDTH - logoWidth) / 2,
        y: contentY,
        width: logoWidth,
        height: logoHeight,
      },
    };
  }

  const qr: Box = { x: pad, y: contentY, width: inner, height: inner };
  const logoX = CARD_WIDTH - pad - logoWidth;
  const captionX = qr.x + qr.width + gap;
  const captionWidth = logoX - gap - captionX;

  return {
    band,
    qr,
    // Defensive: if the two marks ever leave no room between them, drop the
    // words rather than overprint the logo with them.
    caption:
      captionWidth > 0
        ? { x: captionX, y: contentY, width: captionWidth, height: inner, fontSize: inner * 0.22 }
        : null,
    logo: { x: logoX, y: contentY, width: logoWidth, height: logoHeight },
  };
}
