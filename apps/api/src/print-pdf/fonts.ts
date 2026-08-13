/**
 * Font registry for the card→PDF renderer (docs/adr/0162).
 *
 * The card editor stores a stable font *key* (e.g. "Playfair Display") on each
 * text element (see design-fonts.ts `EDITOR_FONTS`). The web app self-hosts the
 * matching Google font; here we embed the *same* typefaces as vendored TTFs so
 * printed text is true vector at the right weight/style — never a rasterised
 * fallback. Real static Regular/Bold/Italic/BoldItalic instances are vendored by
 * `scripts/vendor_print_fonts.py`.
 *
 * A few faces don't ship every variant upstream (Pacifico/Lobster are single
 * weight; Dancing Script/Caveat have no italic axis). For those we embed what
 * exists and flag the missing bold/italic for *synthesis* (faux-bold stroke /
 * oblique skew) in the text renderer — exactly what the browser does for those
 * faces, so screen and print still agree.
 *
 * The three system-stack keys (Helvetica, Times New Roman, Courier New) map to
 * PDF's built-in standard families, whose metrics match those stacks; "Georgia"
 * maps to Gelasio, a metric-compatible embedded substitute.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** Absolute directory holding the vendored `*.ttf` files. Resolves next to this
 * module both in `src` (ts-jest tests) and `dist` (nest-cli copies the TTFs). */
export const FONTS_DIR = join(__dirname, "fonts");

/** A resolved typeface for one (family, bold, italic) combination. */
export interface FontFace {
  /** Stable identifier used as the pdfkit font name (and registration cache key). */
  id: string;
  /** Absolute path to a vendored TTF to embed, when this face is a real file. */
  file?: string;
  /** A PDF built-in standard font name (e.g. "Helvetica-Bold"), when not embedded. */
  builtin?: string;
  /** Apply faux-bold (fill+stroke) because no real bold file exists for this face. */
  synthesizeBold: boolean;
  /** Apply an oblique skew because no real italic file exists for this face. */
  synthesizeItalic: boolean;
}

/** Editor font key → vendored TTF file prefix (the `<prefix>-<Variant>.ttf` set). */
const EMBEDDED_PREFIX: Record<string, string> = {
  Montserrat: "Montserrat",
  Poppins: "Poppins",
  Nunito: "Nunito",
  "Playfair Display": "PlayfairDisplay",
  Lora: "Lora",
  "Dancing Script": "DancingScript",
  Caveat: "Caveat",
  Pacifico: "Pacifico",
  Lobster: "Lobster",
  // System-stack serif → metric-compatible embedded substitute.
  Georgia: "Gelasio",
};

/** Families that ship a real italic (and bold-italic) file. Others synthesise italic. */
const HAS_ITALIC = new Set(["Montserrat", "Poppins", "Nunito", "Playfair Display", "Lora", "Georgia"]);
/** Families that ship a real bold file. Others (single-weight display faces) synthesise bold. */
const HAS_BOLD = new Set([
  "Montserrat",
  "Poppins",
  "Nunito",
  "Playfair Display",
  "Lora",
  "Georgia",
  "Dancing Script",
  "Caveat",
]);

/** PDF built-in standard families for the non-embedded system stacks. */
const BUILTIN: Record<string, { regular: string; bold: string; italic: string; boldItalic: string }> = {
  Helvetica: {
    regular: "Helvetica",
    bold: "Helvetica-Bold",
    italic: "Helvetica-Oblique",
    boldItalic: "Helvetica-BoldOblique",
  },
  "Times New Roman": {
    regular: "Times-Roman",
    bold: "Times-Bold",
    italic: "Times-Italic",
    boldItalic: "Times-BoldItalic",
  },
  "Courier New": {
    regular: "Courier",
    bold: "Courier-Bold",
    italic: "Courier-Oblique",
    boldItalic: "Courier-BoldOblique",
  },
};

/** Neutral fallback for any unknown/legacy family value (mirrors the web treating
 * an unknown key as a system sans). */
const FALLBACK_FAMILY = "Helvetica";

function embeddedFace(prefix: string, family: string, bold: boolean, italic: boolean): FontFace {
  const realItalic = italic && HAS_ITALIC.has(family);
  const realBold = bold && HAS_BOLD.has(family);
  const variant = realBold && realItalic ? "BoldItalic" : realBold ? "Bold" : realItalic ? "Italic" : "Regular";
  const file = join(FONTS_DIR, `${prefix}-${variant}.ttf`);
  return {
    id: `${prefix}-${variant}`,
    file,
    synthesizeBold: bold && !realBold,
    synthesizeItalic: italic && !realItalic,
  };
}

function builtinFace(family: string, bold: boolean, italic: boolean): FontFace {
  const set = BUILTIN[family] ?? BUILTIN[FALLBACK_FAMILY]!;
  const name = bold && italic ? set.boldItalic : bold ? set.bold : italic ? set.italic : set.regular;
  return { id: name, builtin: name, synthesizeBold: false, synthesizeItalic: false };
}

/**
 * Resolve a stored font key + bold/italic toggles to a concrete typeface to draw
 * with. Falls back to a system sans for unknown families, and to an embedded
 * substitute's base weight (with synthesis) when a family lacks a real variant.
 * Pure aside from the one filesystem existence check that guards a missing vendor
 * file (defensive — the full set is committed).
 */
export function resolveFace(fontFamily: string, bold: boolean, italic: boolean): FontFace {
  const prefix = EMBEDDED_PREFIX[fontFamily];
  if (prefix) {
    const face = embeddedFace(prefix, fontFamily, bold, italic);
    if (face.file && existsSync(face.file)) return face;
    // Vendor file somehow absent — degrade to the built-in sans rather than throw.
    return builtinFace(FALLBACK_FAMILY, bold, italic);
  }
  if (BUILTIN[fontFamily]) return builtinFace(fontFamily, bold, italic);
  return builtinFace(FALLBACK_FAMILY, bold, italic);
}

/**
 * Ensure `face` is available on a pdfkit document and return the font name to
 * pass to `doc.font(name)`. Embedded faces are registered once per document
 * (pdfkit caches by name); built-ins are used directly. The caller applies any
 * `synthesizeBold`/`synthesizeItalic` styling itself.
 */
export function registerFace(
  doc: PDFKit.PDFDocument & { _registeredFaces?: Set<string> },
  face: FontFace,
): string {
  if (face.builtin) return face.builtin;
  const registered = (doc._registeredFaces ??= new Set<string>());
  if (!registered.has(face.id)) {
    doc.registerFont(face.id, face.file);
    registered.add(face.id);
  }
  return face.id;
}
