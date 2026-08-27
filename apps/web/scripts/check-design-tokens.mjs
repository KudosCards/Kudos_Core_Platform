#!/usr/bin/env node
/**
 * Contrast guard for the status colour tokens in globals.css.
 *
 * The status palette exists because the brand accent was doing double duty: an
 * ordinary "here's when this posts" notice was painted the same red as "your
 * card was declined", and customers read it as a warning. Colour now carries
 * meaning, which only works if every pairing stays legible.
 *
 * Two of the tones this palette replaced were below WCAG AA for body text — the
 * old error style at 3.71:1 and pill-positive at 4.35:1 — so this is a real
 * regression that has already happened once. It fails the build rather than
 * warning: a tint nudged a shade lighter in a redesign is exactly the kind of
 * change nobody re-measures by hand.
 *
 * Reads the CSS rather than a duplicated table of hex codes, so the stylesheet
 * stays the single source of truth and there is nothing to keep in sync.
 *
 * The second check is that the classes actually exist. Tailwind emits nothing
 * for a class it does not recognise and says nothing about it, so a mistyped
 * token is invisible everywhere: it lints, it typechecks, it builds, and the
 * element simply renders with no colour. That is not hypothetical — the sweep
 * that introduced these tokens rewrote `bg-emerald-500` to `bg-success-soft0`
 * in four places (a `emerald-50` → `success-soft` rule reaching a `-500` class),
 * which silently turned a notification dot, a seat-usage bar and the completed
 * step of the get-started checklist transparent.
 *
 * Usage: node scripts/check-design-tokens.mjs   (or: pnpm test)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(webRoot, "src");
const cssPath = join(srcDir, "app", "globals.css");

/** WCAG 2.1 AA for normal-size body text. */
const AA_BODY = 4.5;
/** WCAG 2.1 AA for icons and other non-text meaning-carrying marks. */
const AA_NON_TEXT = 3;

/** Foreground/background pairings that must stay readable, and why each exists. */
const PAIRS = [
  { fg: "info", bg: "info-soft", min: AA_BODY, use: ".banner-info .banner-lead, .notice-info" },
  {
    fg: "success",
    bg: "success-soft",
    min: AA_BODY,
    use: ".banner-success .banner-lead, .notice-success, .pill-positive",
  },
  {
    fg: "warning",
    bg: "warning-soft",
    min: AA_BODY,
    use: ".banner-warning .banner-lead, .notice-warning",
  },
  {
    fg: "danger",
    bg: "danger-soft",
    min: AA_BODY,
    use: ".banner-danger .banner-lead, .notice-danger",
  },
  // Each tint sits on the page canvas or a white card. It only has to be
  // *visible* as a distinct block, not readable, so the non-text bar applies —
  // and these are deliberately soft, so they sit well under it. Checked at a
  // much lower bar purely to catch a tint drifting to pure white.
  { fg: "info-soft", bg: "background", min: 1.02, use: "banner tint against the page" },
  { fg: "success-soft", bg: "background", min: 1.02, use: "banner tint against the page" },
  { fg: "warning-soft", bg: "background", min: 1.005, use: "banner tint against the page" },
  { fg: "danger-soft", bg: "background", min: 1.02, use: "banner tint against the page" },
];

function readTokens(css) {
  const tokens = new Map();
  // Only the `:root` block — `@theme inline` re-exports these as var() aliases.
  const root = css.slice(css.indexOf(":root {"), css.indexOf("@theme inline"));
  for (const [, name, value] of root.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(name, value.toLowerCase());
  }
  return tokens;
}

/** Relative luminance, per WCAG 2.1 §relative-luminance. */
function luminance(hex) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The colour names `@theme inline` actually exports, i.e. exactly the set
 * Tailwind will generate `bg-*` / `text-*` / `border-*` utilities for.
 */
function readThemeColors(css) {
  const start = css.indexOf("@theme inline");
  const block = css.slice(start, css.indexOf("}", start));
  return new Set([...block.matchAll(/--color-([a-z0-9-]+):/g)].map(([, name]) => name));
}

/**
 * Utility prefixes that take a colour. Restricted to the ones this app uses —
 * a shorter list is a smaller chance of matching ordinary prose.
 */
const COLOUR_UTILITIES =
  "bg|text|border|ring|divide|outline|fill|stroke|shadow|caret|decoration|placeholder|from|via|to";

/**
 * Only names beginning with one of these are judged. They are ours, so a match
 * is unambiguously an attempt to use a token — unlike `background`/`foreground`,
 * which read as English and would flag comments rather than classes.
 */
const SEMANTIC_ROOTS = ["accent", "info", "success", "warning", "danger", "surface", "muted"];

const CLASS_RE = new RegExp(
  `(?<![a-z0-9-])(?:${COLOUR_UTILITIES})-((?:${SEMANTIC_ROOTS.join("|")})[a-z0-9-]*)`,
  "g",
);

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(tsx?|css)$/.test(entry.name)) yield full;
  }
}

function checkClassNames(themeColors) {
  const bad = [];
  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      for (const [match, name] of line.matchAll(CLASS_RE)) {
        if (themeColors.has(name)) continue;
        bad.push(`${relative(webRoot, file)}:${i + 1}  ${match}`);
      }
    });
  }
  return bad;
}

const css = readFileSync(cssPath, "utf8");
const tokens = readTokens(css);
const failures = [];
const rows = [];

for (const { fg, bg, min, use } of PAIRS) {
  const fgHex = tokens.get(fg);
  const bgHex = tokens.get(bg);
  if (!fgHex || !bgHex) {
    failures.push(`--${fg} / --${bg}: token missing from :root in globals.css`);
    continue;
  }
  const ratio = contrast(fgHex, bgHex);
  rows.push(
    `  ${`--${fg}`.padEnd(16)} on ${`--${bg}`.padEnd(16)} ${ratio.toFixed(2)}:1  (min ${min})  ${use}`,
  );
  if (ratio < min) {
    failures.push(
      `--${fg} (${fgHex}) on --${bg} (${bgHex}) is ${ratio.toFixed(2)}:1, below the required ${min}:1 — used by ${use}`,
    );
  }
}

console.log(`Design token contrast (WCAG AA body ${AA_BODY}:1, non-text ${AA_NON_TEXT}:1):`);
console.log(rows.join("\n"));

if (failures.length > 0) {
  console.error(`\n${failures.length} contrast failure(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    "\nDarken the foreground token or lighten its tint until the pairing clears the bar.",
  );
  process.exit(1);
}

const themeColors = readThemeColors(css);
const unknownClasses = checkClassNames(themeColors);
const known = [...themeColors]
  .filter((c) => SEMANTIC_ROOTS.some((root) => c === root || c.startsWith(`${root}-`)))
  .sort();

if (unknownClasses.length > 0) {
  console.error(
    `\n${unknownClasses.length} class(es) naming a colour @theme inline never exports:`,
  );
  for (const c of unknownClasses) console.error(`  ✗ ${c}`);
  console.error(
    `\nTailwind emits nothing for these, so they render with no colour at all. Exported: ${known.join(", ")}.`,
  );
  process.exit(1);
}

console.log(`\nAll ${PAIRS.length} pairings pass.`);
console.log(`Every ${known.length}-token colour class in src/ resolves.`);
