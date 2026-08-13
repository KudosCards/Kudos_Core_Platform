/**
 * Glyph-run segmentation for the card→PDF text engine (docs/adr/0162, Phase 3).
 *
 * The card editor renders text with a browser, which silently falls back to a
 * system font for any glyph the chosen font lacks (an emoji, an unusual symbol).
 * The server PDF engine embeds one font per element, so without help a missing
 * glyph prints as a `.notdef` "tofu" box. This module reproduces the browser's
 * behaviour: given the element's primary font plus an ordered list of fallback
 * fonts, it splits a string into consecutive *runs*, each tagged with the first
 * font (by index) able to render every character in it. The renderer then draws
 * each run in its own font, advancing the pen by the run's measured width.
 *
 * Pure: the caller supplies a coverage probe per font (`covers(codePoint)`),
 * typically fontkit's `hasGlyphForCodePoint`. No pdfkit or I/O here.
 */

/** Whether a font can render a given Unicode code point. */
export interface GlyphCoverage {
  covers(codePoint: number): boolean;
}

/** A maximal slice of text drawn in a single font (index into the font list). */
export interface GlyphRun {
  text: string;
  /** Index into the `coverages` array passed to {@link splitGlyphRuns}; 0 = primary. */
  fontIndex: number;
}

/**
 * Zero-width joiners and variation selectors carry no glyph of their own — they
 * modify the run they sit in (emoji ZWJ sequences, VS15/VS16 text/emoji
 * presentation). Attaching them to the current run (rather than font-probing
 * them) keeps an emoji sequence whole and stops a selector from tofu-ing.
 */
const STICKY_CODEPOINTS = new Set([
  0x200d, // ZERO WIDTH JOINER
  0xfe0e, // VARIATION SELECTOR-15 (text presentation)
  0xfe0f, // VARIATION SELECTOR-16 (emoji presentation)
]);

/**
 * Split `text` into runs, each assigned the index of the first font in
 * `coverages` that covers every code point in the run. A code point no font
 * covers is assigned to the primary font (index 0) — it prints as a
 * missing-glyph box, the same best-effort as before fallback existed, rather
 * than being dropped. Iterates by code point (`for…of`), so astral characters
 * (emoji) are never split across a surrogate pair. Pure.
 */
export function splitGlyphRuns(text: string, coverages: GlyphCoverage[]): GlyphRun[] {
  const runs: GlyphRun[] = [];

  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    const last = runs[runs.length - 1];

    // Format marks join whatever run precedes them (kept with their base glyph).
    if (last && STICKY_CODEPOINTS.has(codePoint)) {
      last.text += ch;
      continue;
    }

    let fontIndex = coverages.findIndex((coverage) => coverage.covers(codePoint));
    if (fontIndex < 0) fontIndex = 0;

    if (last && last.fontIndex === fontIndex) {
      last.text += ch;
    } else {
      runs.push({ text: ch, fontIndex });
    }
  }

  return runs;
}
