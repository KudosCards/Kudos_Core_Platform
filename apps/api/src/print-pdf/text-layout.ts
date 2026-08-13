/**
 * Text layout for the card→PDF renderer (docs/adr/0162), reproducing Konva's
 * `Text` node so server-rendered text breaks and sits exactly where the editor
 * and read-only previews put it (card-face-preview.tsx).
 *
 * Two things must match Konva:
 *  1. Word wrapping — greedy, break at spaces, hard-break a word longer than the
 *     box (Konva's `wrap="word"`), measured with the *same* embedded font.
 *  2. Vertical placement — Konva (modern text rendering) draws each line on its
 *     alphabetic baseline at `translateY + n·lineHeightPx`, where
 *     `lineHeightPx = 1.3·fontSize` and
 *     `translateY = (ascent − descent)/2 + lineHeightPx/2`, with ascent/descent
 *     the font's bounding-box metrics. We take those metrics from the embedded
 *     font, so the maths is identical.
 *
 * Pure: callers pass a `measure(text)` closure (pdfkit `widthOfString` at the
 * element's font/size) and the font's em-scaled ascent/descent, so this module
 * has no pdfkit dependency and is unit-tested directly.
 */

/** Konva line-height multiplier used by every card renderer (card-face-preview). */
export const LINE_HEIGHT = 1.3;

/**
 * Break `text` into display lines within `maxWidth`, matching Konva `wrap="word"`:
 * honour explicit "\n" paragraph breaks, greedily pack words, and hard-break a
 * single word that itself exceeds the box. `measure` returns the rendered width
 * of a string in the same units as `maxWidth`. Pure.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let current = "";

    const flush = () => {
      lines.push(current);
      current = "";
    };

    for (let w = 0; w < words.length; w++) {
      const word = words[w]!;
      const candidate = current === "" ? word : `${current} ${word}`;
      if (measure(candidate) <= maxWidth || current === "") {
        // Fits, or the line is empty so we must place at least this word.
        if (measure(candidate) <= maxWidth) {
          current = candidate;
          continue;
        }
        // Empty line but the lone word overflows → hard-break it by characters.
        const pieces = breakLongWord(word, maxWidth, measure);
        // All but the last piece are complete lines; the last seeds `current`.
        for (let p = 0; p < pieces.length - 1; p++) lines.push(pieces[p]!);
        current = pieces[pieces.length - 1] ?? "";
      } else {
        // Doesn't fit on the current (non-empty) line → wrap the word down.
        flush();
        if (measure(word) <= maxWidth) {
          current = word;
        } else {
          const pieces = breakLongWord(word, maxWidth, measure);
          for (let p = 0; p < pieces.length - 1; p++) lines.push(pieces[p]!);
          current = pieces[pieces.length - 1] ?? "";
        }
      }
    }
    flush();
  }

  return lines;
}

/** Split a word too wide for the box into character chunks that each fit. Never
 * returns an empty array; a single character that overflows is kept on its own
 * line (as Konva does — it can't break below one glyph). */
function breakLongWord(word: string, maxWidth: number, measure: (s: string) => number): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const ch of word) {
    const candidate = chunk + ch;
    if (chunk !== "" && measure(candidate) > maxWidth) {
      chunks.push(chunk);
      chunk = ch;
    } else {
      chunk = candidate;
    }
  }
  if (chunk !== "") chunks.push(chunk);
  return chunks.length > 0 ? chunks : [word];
}

/** Horizontal offset (added to the box's left x) that aligns a line of width
 * `lineWidth` within a box of width `boxWidth`. Matches Konva's per-line align. */
export function alignOffset(align: "left" | "center" | "right", boxWidth: number, lineWidth: number): number {
  if (align === "right") return boxWidth - lineWidth;
  if (align === "center") return (boxWidth - lineWidth) / 2;
  return 0;
}

export interface BaselineMetrics {
  /** Line pitch in the text's own units (design units): 1.3 × fontSize. */
  lineHeightPx: number;
  /** Alphabetic baseline of the first line, measured down from the element's top. */
  firstBaseline: number;
}

/**
 * Konva's vertical text metrics for a given font size and font ascent/descent.
 * `ascentEm`/`descentEm` are the font's bounding-box ascent/descent as fractions
 * of the em (e.g. pdfkit's `ascender/1000`, `-descender/1000`). The alphabetic
 * baseline of line `n` is `firstBaseline + n·lineHeightPx`. Pure.
 */
export function baselineMetrics(fontSize: number, ascentEm: number, descentEm: number): BaselineMetrics {
  const lineHeightPx = LINE_HEIGHT * fontSize;
  const ascent = ascentEm * fontSize;
  const descent = descentEm * fontSize;
  const firstBaseline = (ascent - descent) / 2 + lineHeightPx / 2;
  return { lineHeightPx, firstBaseline };
}
