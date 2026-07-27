#!/usr/bin/env node
/**
 * Turbopack-compatible bundle size report.
 *
 * `@next/bundle-analyzer` hooks the webpack config, which a Turbopack build
 * (the Next 16 default) never runs — so it produces nothing here. This reads the
 * chunks Turbopack actually emitted instead: it lists the largest client chunks
 * and checks that the heavy, lazy-only libraries (react-konva — the card
 * editor/preview) stay isolated in their own chunk rather than leaking into the
 * shared framework chunk that every page loads.
 *
 * Usage: pnpm build && node scripts/analyze-bundle.mjs   (or: pnpm analyze:bundle)
 * Exits non-zero if a lazy-only library is found in the largest (framework) chunk.
 * See docs/adr/0047-bundle-audit.md.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const chunksDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".next", "static", "chunks");

/** Libraries that should only ever appear in a lazily-loaded chunk. */
const LAZY_ONLY = ["konva"];
const TOP_N = 12;

let files;
try {
  files = readdirSync(chunksDir, { recursive: true })
    .filter((f) => typeof f === "string" && f.endsWith(".js"))
    .map((f) => {
      const path = join(chunksDir, f);
      return { name: f, path, size: statSync(path).size };
    })
    .sort((a, b) => b.size - a.size);
} catch {
  console.error(`No build output at ${chunksDir}. Run \`pnpm build\` first.`);
  process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const total = files.reduce((s, f) => s + f.size, 0);

console.log(`\nClient chunks: ${files.length} files, ${kb(total)} total\n`);
console.log(`Largest ${TOP_N}:`);
for (const f of files.slice(0, TOP_N)) {
  console.log(`  ${kb(f.size).padStart(8)}  ${f.name}`);
}

// The largest chunk is the shared React/Next framework runtime that every page
// loads on first paint — nothing lazy-only belongs in it.
const frameworkChunk = files[0];
let failed = false;
console.log(`\nCode-splitting checks (framework chunk = ${frameworkChunk.name}):`);
for (const lib of LAZY_ONLY) {
  const carriers = files.filter((f) => readFileSync(f.path, "utf8").includes(lib));
  const inFramework = carriers.some((f) => f.name === frameworkChunk.name);
  const where = carriers.map((f) => `${f.name} (${kb(f.size)})`).join(", ") || "not bundled";
  console.log(`  ${inFramework ? "✗" : "✓"} ${lib}: ${where}`);
  if (inFramework) failed = true;
}

if (failed) {
  console.error("\nA lazy-only library leaked into the framework chunk — check its import path.");
  process.exit(1);
}
console.log("\nOK — heavy lazy-only libraries stay code-split.\n");
