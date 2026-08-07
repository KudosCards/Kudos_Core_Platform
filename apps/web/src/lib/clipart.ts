/**
 * The clip-art library — richer, illustrative birthday artwork, distinct from
 * the small icon-like Stickers. Each item is a self-hosted asset under
 * `public/clipart/` (a cleaned vector SVG, or a print-grade WebP for the few
 * illustrations too heavy to ship as vector), placed on the card as a normal
 * image element so it gets resize / rotate / snap / layer for free.
 *
 * The list is generated: drop SVGs into `clipart-src/<category>/` and run
 * `pnpm clipart:build`, which rewrites `clipart-manifest.json` and the assets.
 * Don't hand-edit the manifest — regenerate it.
 */
import manifest from "./clipart-manifest.json";

export interface ClipartItem {
  /** Stable unique id ("<category>-<file stem>"). */
  key: string;
  /** Human label shown on the picker tile. */
  label: string;
  /** Category id it belongs to (matches a `clipart-src/` folder). */
  category: string;
  /** Root-relative path to the placement asset (SVG or WebP). */
  src: string;
  /** Root-relative path to the small WebP picker thumbnail. */
  thumb: string;
  /** Intrinsic width/height (design units) — used to place at true aspect. */
  width: number;
  height: number;
}

export const CLIPART: ClipartItem[] = manifest;

/** The design-space longest side a freshly-placed clip-art item gets; the other
 * side follows its intrinsic ratio (so wide word-art isn't squished). */
export const CLIPART_INSERT_MAX = 200;

export interface ClipartCategory {
  id: string;
  label: string;
  items: ClipartItem[];
}

/** Display order + labels for the categories; anything unlisted falls to the
 * end with a humanised label, so a new source folder still shows up. */
const CATEGORY_ORDER = ["objects", "greetings"];
const CATEGORY_LABELS: Record<string, string> = {
  objects: "Objects",
  greetings: "Greetings",
};

function categoryLabel(id: string): string {
  return CATEGORY_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Clip-art grouped into ordered categories for the picker. */
export const CLIPART_CATEGORIES: ClipartCategory[] = (() => {
  const ids = Array.from(new Set(CLIPART.map((c) => c.category)));
  ids.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib) || a.localeCompare(b);
  });
  return ids.map((id) => ({
    id,
    label: categoryLabel(id),
    items: CLIPART.filter((c) => c.category === id),
  }));
})();
