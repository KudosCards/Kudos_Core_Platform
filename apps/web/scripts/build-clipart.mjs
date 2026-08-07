// Clip-art build pipeline.
//
// Turns the raw designer SVGs under `clipart-src/<category>/*.svg` into the
// web-ready assets the card editor serves, plus a manifest the editor imports.
//
// The "dev drops files in" workflow: add an SVG to `clipart-src/objects/` or
// `clipart-src/greetings/` (create more category folders as needed) and run
// `pnpm clipart:build`. Everything under `public/clipart/` and the manifest is
// regenerated — commit the result.
//
// For each source SVG this:
//   1. Optimises it with SVGO — strips all editor/Creative-Commons metadata
//      (dc/cc/rdf), comments and cruft, and trims path precision. viewBox is
//      kept so the art stays scalable and we can read its intrinsic size.
//   2. Renders a small WebP thumbnail for the picker, so the editor never loads
//      a multi-MB illustration just to show a chip.
//   3. Chooses the placement asset: the cleaned SVG when it's light enough
//      (crisp vector, ideal for print), else a print-grade WebP raster for the
//      few illustrations that stay heavy after cleaning (keeps the canvas
//      smooth; still ~300+ dpi at A6).
//
// Pure Node + svgo + sharp, no network. Run from apps/web.

import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { optimize } from "svgo";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const SRC_ROOT = path.join(WEB_ROOT, "clipart-src");
const OUT_ROOT = path.join(WEB_ROOT, "public", "clipart");
const MANIFEST = path.join(WEB_ROOT, "src", "lib", "clipart-manifest.json");

// Above this cleaned-SVG size (bytes), place a rasterised WebP instead of the
// vector, so a huge illustration doesn't tax the canvas. Vector is kept below it.
const RASTER_ABOVE_BYTES = 220_000;
const THUMB_PX = 240; // longest side of the picker thumbnail
const PLACE_PX = 1600; // longest side of a rasterised placement asset (print-grade)

// SVGO: preset-default keeps viewBox by default (we need the intrinsic ratio)
// and removes metadata, comments, editor namespaces and unused ids;
// removeDimensions then drops width/height so the art scales to any box.
const SVGO_CONFIG = {
  multipass: true,
  plugins: ["preset-default", "removeDimensions"],
};

// Nicer labels than a raw filename; anything not listed is humanised from the
// file stem (prefixes like "birthday_"/"happy_birthday_" stripped).
const LABEL_OVERRIDES = {
  birthday_cake_happy_birthday: "Cake with banner",
  happy_birthday_woods_color: "Woodland",
  happy_birthday_deco: "Deco",
  birthday_decor: "Bunting",
};

function humaniseLabel(stem) {
  if (LABEL_OVERRIDES[stem]) return LABEL_OVERRIDES[stem];
  const words = stem.replace(/^happy_birthday_/, "").replace(/^birthday_/, "").replace(/_/g, " ").trim();
  const label = words || stem.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Intrinsic width/height from a viewBox, else the width/height attributes. */
function readIntrinsicSize(svg) {
  const vb = svg.match(/viewBox\s*=\s*["']\s*([\d.eE+-]+)[ ,]+([\d.eE+-]+)[ ,]+([\d.eE+-]+)[ ,]+([\d.eE+-]+)/);
  if (vb) {
    const w = Number(vb[3]);
    const h = Number(vb[4]);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  const wAttr = svg.match(/\bwidth\s*=\s*["']\s*([\d.]+)/);
  const hAttr = svg.match(/\bheight\s*=\s*["']\s*([\d.]+)/);
  if (wAttr && hAttr) return { width: Number(wAttr[1]), height: Number(hAttr[1]) };
  return { width: 100, height: 100 };
}

/** sharp density (DPI) that renders the SVG so its longest side is ~targetPx
 * native — avoids blur on tiny viewBoxes and runaway memory on huge ones. */
function densityFor(size, targetPx) {
  const longest = Math.max(size.width, size.height);
  return Math.min(2400, Math.max(72, Math.ceil((targetPx * 96) / longest)));
}

async function toWebp(svg, size, targetPx, quality) {
  return sharp(Buffer.from(svg), { density: densityFor(size, targetPx) })
    .resize({ width: targetPx, height: targetPx, fit: "inside", withoutEnlargement: false })
    .webp({ quality })
    .toBuffer();
}

function listCategories() {
  if (!fs.existsSync(SRC_ROOT)) return [];
  return fs
    .readdirSync(SRC_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

async function main() {
  // Rebuild the output tree from scratch so removed sources don't linger.
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUT_ROOT, { recursive: true });

  const items = [];
  for (const category of listCategories()) {
    const srcDir = path.join(SRC_ROOT, category);
    const outDir = path.join(OUT_ROOT, category);
    fs.mkdirSync(outDir, { recursive: true });
    const files = fs.readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith(".svg")).sort();

    for (const file of files) {
      const stem = file.replace(/\.svg$/i, "");
      const key = `${category}-${stem}`;
      const raw = fs.readFileSync(path.join(srcDir, file), "utf8");
      const cleaned = optimize(raw, SVGO_CONFIG).data;
      const size = readIntrinsicSize(cleaned);

      // Thumbnail — always a tiny WebP, so the picker stays light.
      const thumbBuf = await toWebp(cleaned, size, THUMB_PX, 80);
      const thumbRel = `/clipart/${category}/${stem}.thumb.webp`;
      fs.writeFileSync(path.join(outDir, `${stem}.thumb.webp`), thumbBuf);

      // Placement asset — cleaned SVG when light, else a print-grade WebP.
      let src;
      if (Buffer.byteLength(cleaned) <= RASTER_ABOVE_BYTES) {
        fs.writeFileSync(path.join(outDir, `${stem}.svg`), cleaned);
        src = `/clipart/${category}/${stem}.svg`;
      } else {
        const placeBuf = await toWebp(cleaned, size, PLACE_PX, 88);
        fs.writeFileSync(path.join(outDir, `${stem}.webp`), placeBuf);
        src = `/clipart/${category}/${stem}.webp`;
      }

      items.push({
        key,
        label: humaniseLabel(stem),
        category,
        src,
        thumb: thumbRel,
        width: Math.round(size.width),
        height: Math.round(size.height),
      });
      const kind = src.endsWith(".svg") ? "svg" : "webp";
      console.log(`  ${key.padEnd(34)} ${kind.padEnd(4)} ${size.width}x${size.height}`);
    }
  }

  items.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  fs.writeFileSync(MANIFEST, JSON.stringify(items, null, 2) + "\n");
  console.log(`\nWrote ${items.length} clip-art items to ${path.relative(WEB_ROOT, MANIFEST)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
