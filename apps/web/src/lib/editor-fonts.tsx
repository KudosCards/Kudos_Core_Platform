/**
 * Self-hosted web fonts for the card editor. Next fetches these Google fonts at
 * build time and serves them from our own domain (no runtime Google request,
 * CSP-friendly) — the "self-hosted fonts" the editor offers on top of the
 * system stacks.
 *
 * Designs store a *stable* font key (e.g. "Playfair Display", from
 * `EDITOR_FONTS` in shared-types), never Next's build-hashed family name. This
 * module maps that key to the real loaded family for the Konva renderers, and
 * exposes a preloader that warms every weight/style so the canvas draws them
 * correctly once fonts settle.
 */
import {
  Caveat,
  Dancing_Script,
  Lobster,
  Lora,
  Montserrat,
  Nunito,
  Pacifico,
  Playfair_Display,
  Poppins,
} from "next/font/google";

// Variable fonts (weight covered by the variable axis) that also ship an italic
// axis — bold and italic both render for real.
const montserrat = Montserrat({ subsets: ["latin"], style: ["normal", "italic"], display: "swap" });
const nunito = Nunito({ subsets: ["latin"], style: ["normal", "italic"], display: "swap" });
const playfair = Playfair_Display({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});
const lora = Lora({ subsets: ["latin"], style: ["normal", "italic"], display: "swap" });
// Static font — explicit weights, with italics.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
});
// Variable, no italic axis.
const dancingScript = Dancing_Script({ subsets: ["latin"], display: "swap" });
const caveat = Caveat({ subsets: ["latin"], display: "swap" });
// Single-weight display faces (bold/italic fall back to browser synthesis).
const pacifico = Pacifico({ subsets: ["latin"], weight: "400", display: "swap" });
const lobster = Lobster({ subsets: ["latin"], weight: "400", display: "swap" });

/** Stable font key (as stored in a design) → the actual loaded CSS family. */
const WEB_FONT_BY_KEY: Record<string, string> = {
  Montserrat: montserrat.style.fontFamily,
  Poppins: poppins.style.fontFamily,
  Nunito: nunito.style.fontFamily,
  "Playfair Display": playfair.style.fontFamily,
  Lora: lora.style.fontFamily,
  "Dancing Script": dancingScript.style.fontFamily,
  Caveat: caveat.style.fontFamily,
  Pacifico: pacifico.style.fontFamily,
  Lobster: lobster.style.fontFamily,
};

/**
 * Resolve a stored font key to the CSS family the browser/Konva should use.
 * Self-hosted web fonts map to their build-hashed family; system stacks (and
 * any unknown legacy value) resolve to themselves so old designs are unchanged.
 */
export function resolveFontFamily(key: string): string {
  return WEB_FONT_BY_KEY[key] ?? key;
}

/** All web-font CSS families (for the preloader / redraw wait). */
export const WEB_FONT_CSS_FAMILIES: string[] = Object.values(WEB_FONT_BY_KEY);

/**
 * Warm the web fonts so Konva draws them correctly. Canvas text doesn't
 * participate in normal CSS font preloading, and Konva doesn't redraw when a
 * font arrives — so we render hidden text in each family + weight/style to force
 * the browser to fetch every file up front. Combined with a
 * `document.fonts.ready` redraw (see `useFontsReady`), the first correct paint
 * lands as soon as the fonts settle. Pass `only` to warm just the families a
 * read-only preview actually uses.
 */
export function FontPreloader({ only }: { only?: string[] }) {
  const families = only
    ? only.map(resolveFontFamily).filter((f) => WEB_FONT_CSS_FAMILIES.includes(f))
    : WEB_FONT_CSS_FAMILIES;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
      }}
    >
      {families.map((family) => (
        <span key={family}>
          <span style={{ fontFamily: family }}>Aa</span>
          <span style={{ fontFamily: family, fontWeight: 700 }}>Aa</span>
          <span style={{ fontFamily: family, fontStyle: "italic" }}>Aa</span>
          <span style={{ fontFamily: family, fontWeight: 700, fontStyle: "italic" }}>Aa</span>
        </span>
      ))}
    </div>
  );
}
