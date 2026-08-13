/**
 * Minimal ambient types for the slice of `fontkit` the print engine uses.
 * fontkit@2 ships no bundled declarations and there is no maintained
 * `@types/fontkit` for it; we only need `openSync` + per-glyph coverage, so we
 * declare exactly that rather than pull in an unmaintained stub. See
 * docs/adr/0162 (Phase 3, emoji/symbol fallback).
 */
declare module "fontkit" {
  interface Font {
    /** True if this font has a glyph for the Unicode code point (cmap lookup). */
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  /** Open a font file synchronously. May return a collection; the engine only
   * opens single-face TTFs, so we type the single-font case. */
  function openSync(path: string): Font;
  const _default: { openSync: typeof openSync };
  export { openSync, Font };
  export default _default;
}
