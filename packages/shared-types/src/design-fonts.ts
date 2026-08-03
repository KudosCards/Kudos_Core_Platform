/**
 * The card editor's font catalogue and text-style helpers, shared so the editor
 * dropdown, both Konva renderers, and any future server render agree on exactly
 * which fonts exist and how bold/italic/underline map to Konva props.
 *
 * The catalogue holds only stable *keys* (e.g. "Playfair Display") — the value
 * stored in a design's `fontFamily`. The web app maps each key to the actual
 * loaded CSS family (Next self-hosts the web fonts, whose real family names are
 * build-hashed and so must never be persisted). Keeping the key stable means a
 * saved design keeps its font across rebuilds.
 */

/** How fonts are grouped in the picker. */
export type FontCategory = "sans" | "serif" | "handwriting" | "display" | "monospace";

export interface EditorFont {
  /** Stable value stored in `text.fontFamily`; also the human label. */
  key: string;
  /** Grouping in the picker. */
  category: FontCategory;
  /**
   * True for a web font the app self-hosts (via next/font); false for a
   * system font stack that needs no loading. Lets the web resolver and the
   * preloader treat the two differently.
   */
  webFont: boolean;
}

/**
 * The card fonts, richest-first within groups. System stacks (no load needed)
 * plus a curated set of self-hosted Google fonts. Order here is the picker
 * order. Adding a font is additive — existing designs are unaffected.
 */
export const EDITOR_FONTS: readonly EditorFont[] = [
  // System stacks — always available, no web load.
  { key: "Helvetica", category: "sans", webFont: false },
  { key: "Georgia", category: "serif", webFont: false },
  { key: "Times New Roman", category: "serif", webFont: false },
  { key: "Courier New", category: "monospace", webFont: false },
  // Self-hosted web fonts.
  { key: "Montserrat", category: "sans", webFont: true },
  { key: "Poppins", category: "sans", webFont: true },
  { key: "Nunito", category: "sans", webFont: true },
  { key: "Playfair Display", category: "serif", webFont: true },
  { key: "Lora", category: "serif", webFont: true },
  { key: "Dancing Script", category: "handwriting", webFont: true },
  { key: "Caveat", category: "handwriting", webFont: true },
  { key: "Pacifico", category: "display", webFont: true },
  { key: "Lobster", category: "display", webFont: true },
] as const;

/** Human labels for each category, in the order the picker should show them. */
export const FONT_CATEGORY_ORDER: { category: FontCategory; label: string }[] = [
  { category: "sans", label: "Sans-serif" },
  { category: "serif", label: "Serif" },
  { category: "handwriting", label: "Handwriting" },
  { category: "display", label: "Display" },
  { category: "monospace", label: "Monospace" },
];

/** The stable keys of just the self-hosted web fonts, for the web loader. */
export const WEB_FONT_KEYS: readonly string[] = EDITOR_FONTS.filter((f) => f.webFont).map(
  (f) => f.key,
);

/**
 * Map bold/italic toggles to Konva's `fontStyle` string. Konva accepts
 * "normal" | "bold" | "italic" | "italic bold". Pure.
 */
export function konvaFontStyle(bold?: boolean, italic?: boolean): string {
  if (bold && italic) return "italic bold";
  if (bold) return "bold";
  if (italic) return "italic";
  return "normal";
}

/** Map the underline toggle to Konva's `textDecoration`. Konva uses "underline"
 * or "" (none). Pure. */
export function konvaTextDecoration(underline?: boolean): string {
  return underline ? "underline" : "";
}
