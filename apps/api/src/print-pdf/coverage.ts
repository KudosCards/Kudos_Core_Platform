/**
 * Per-font glyph coverage for the card→PDF text engine (docs/adr/0162, Phase 3).
 *
 * Turns a resolved {@link FontFace} into a {@link GlyphCoverage} probe that
 * answers "can this font render code point N?" so {@link splitGlyphRuns} can
 * route each character to the first font that covers it.
 *
 *  - Embedded faces (a vendored TTF): probed exactly via fontkit's cmap. The
 *    opened font is cached per file — a run renders one design, but a run has
 *    many recipients, so this is opened once per process, not once per card.
 *  - Built-in PDF standard faces (Helvetica/Times/Courier — no file): pdfkit
 *    can only encode the WinAnsi set for these, so coverage is that fixed set.
 *    Under-claiming here is safe (the character just falls to a fallback font);
 *    over-claiming would print tofu, so the set is the conservative WinAnsi one.
 */

import { openSync, type Font } from "fontkit";
import type { GlyphCoverage } from "./glyph-runs";
import type { FontFace } from "./fonts";

const fontCache = new Map<string, Font>();

function openCached(file: string): Font {
  let font = fontCache.get(file);
  if (!font) {
    font = openSync(file);
    fontCache.set(file, font);
  }
  return font;
}

/**
 * The Unicode code points WinAnsi (CP1252) can encode — the only characters
 * pdfkit's built-in standard fonts can draw. Basic Latin + Latin-1 supplement
 * printables, plus the CP1252 0x80–0x9F "smart" punctuation (curly quotes,
 * dashes, ellipsis, bullet, euro, trademark, …) that map to higher code points.
 */
const WINANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function winAnsiCovers(codePoint: number): boolean {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true; // printable ASCII
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true; // Latin-1 supplement
  return WINANSI_EXTRA.has(codePoint);
}

/** A coverage probe for a resolved face: exact cmap for embedded TTFs, the
 * WinAnsi set for built-in standard fonts. */
export function coverageForFace(face: FontFace): GlyphCoverage {
  if (face.file) {
    const font = openCached(face.file);
    return { covers: (codePoint) => font.hasGlyphForCodePoint(codePoint) };
  }
  return { covers: winAnsiCovers };
}
