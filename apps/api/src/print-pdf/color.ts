/**
 * CSS colour parsing for the card→PDF renderer (docs/adr/0162).
 *
 * Design documents store colours as CSS strings from the editor's colour inputs
 * — almost always `#rgb`/`#rrggbb`, occasionally `#rrggbbaa` or `rgb()/rgba()`.
 * pdfkit wants an `#rrggbb` (or named) colour plus a separate opacity, so this
 * splits an incoming string into `{ color, opacity }`. Unknown strings pass
 * through untouched (pdfkit resolves standard named colours). Pure.
 */

export interface ParsedColor {
  /** A pdfkit-acceptable colour: `#rrggbb`, a named colour, or the original. */
  color: string;
  /** Alpha in [0, 1]; 1 when the source carries no alpha. */
  opacity: number;
}

function expandHex(hex: string): string {
  // #rgb → #rrggbb, #rgba → #rrggbbaa
  if (hex.length === 4 || hex.length === 5) {
    return "#" + hex.slice(1).split("").map((c) => c + c).join("");
  }
  return hex;
}

export function parseColor(input: string): ParsedColor {
  const value = input.trim();

  if (value.startsWith("#")) {
    const hex = expandHex(value);
    if (hex.length === 9) {
      // #rrggbbaa
      const alpha = parseInt(hex.slice(7, 9), 16) / 255;
      return { color: hex.slice(0, 7), opacity: clamp01(alpha) };
    }
    return { color: hex, opacity: 1 };
  }

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1]!.split(",").map((p) => p.trim());
    const [r, g, b] = parts;
    const a = parts[3];
    const toHex = (n: string) => clampByte(Math.round(parseFloat(n))).toString(16).padStart(2, "0");
    if (r !== undefined && g !== undefined && b !== undefined) {
      const opacity = a !== undefined ? clamp01(parseFloat(a)) : 1;
      return { color: `#${toHex(r)}${toHex(g)}${toHex(b)}`, opacity };
    }
  }

  return { color: value, opacity: 1 };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

function clampByte(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(255, Math.max(0, n));
}
