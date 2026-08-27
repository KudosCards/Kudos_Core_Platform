#!/usr/bin/env node
/**
 * Rebuild the ADR index in `docs/adr/README.md` from the ADRs themselves.
 *
 * The index existed and had stopped being true: it listed ten records out of a
 * hundred and seventy-two, all of them from the project's first weeks. That is
 * worse than having no index, because three READMEs — the root, the web app's
 * and the API's — send you to `docs/adr` "for the reasoning behind key
 * decisions", and GitHub renders this file as that directory's landing page. So
 * the answer to "what have we decided?" was a list that stopped in month one.
 *
 * A hand-maintained list of 172 entries would be stale again within a month, and
 * hand-copying 172 titles is exactly where a wrong one creeps in. So the list is
 * generated from each ADR's own H1 and checked in CI (`--check`), which makes
 * drift impossible rather than merely unlikely: adding an ADR without rerunning
 * this fails the build.
 *
 * Only the region between the two markers is rewritten. The prose above it is
 * written by people and stays that way.
 *
 * Usage:
 *   node scripts/build-adr-index.mjs           rewrite the index
 *   node scripts/build-adr-index.mjs --check    fail if the index is stale
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const adrDir = join(repoRoot, "docs", "adr");
const indexPath = join(adrDir, "README.md");

const START = "<!-- adr-index:start -->";
const END = "<!-- adr-index:end -->";

/**
 * An ADR's H1, in either of the two forms the corpus actually uses.
 *
 * The first 58 records (0001–0059, plus 0164 and 0165) follow the original
 * template — `# ADR 0001 — Title` — and nine of those, 0042 to 0050, use a colon
 * rather than an em dash. Everything since uses `# 0170 — Title`. Accepting both
 * here rather than rewriting 58 historical documents: the inconsistency is only
 * visible to this script, and rewriting the title of a decision record to please
 * a generator is the tail wagging the dog.
 */
const H1 = /^#\s+(?:ADR\s+)?(\d{4})\s*(?:—|:|-)\s*(.+?)\s*$/;

/** Not decision records: the landing page itself and the blank template. */
const NOT_AN_ADR = new Set(["README.md", "0000-template.md"]);

function readAdrs() {
  const files = readdirSync(adrDir)
    .filter((name) => name.endsWith(".md") && !NOT_AN_ADR.has(name))
    .sort();

  const problems = [];
  const seen = new Map();
  const entries = [];

  for (const file of files) {
    const firstLine = readFileSync(join(adrDir, file), "utf8").split("\n", 1)[0] ?? "";
    const match = H1.exec(firstLine);
    if (!match) {
      problems.push(`${file}: first line is not an ADR title — got ${JSON.stringify(firstLine)}`);
      continue;
    }
    const [, number, title] = match;

    // The number in the filename and the number in the title must agree, or a
    // citation ("see ADR 0166") resolves to a different document depending on
    // whether the reader searched the filename or the heading.
    const filePrefix = file.slice(0, 4);
    if (filePrefix !== number) {
      problems.push(`${file}: filename says ${filePrefix} but the title says ${number}`);
      continue;
    }
    const duplicate = seen.get(number);
    if (duplicate) {
      problems.push(`${file}: number ${number} is already used by ${duplicate}`);
      continue;
    }
    seen.set(number, file);
    entries.push({ number, title, file });
  }

  if (problems.length > 0) {
    console.error(`${problems.length} ADR(s) could not be indexed:`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error("\nFix the ADR rather than this script — the index is generated from the files.");
    process.exit(1);
  }

  entries.sort((a, b) => Number(a.number) - Number(b.number));
  return entries;
}

/**
 * The title goes inside a Markdown link label, and some of these titles contain
 * brackets — `[name]` in 0053, `/admin/orders/[id]` in 0123. Both are balanced,
 * which CommonMark handles inside a link label, so they are emitted verbatim;
 * escaping them would put backslashes in front of readers. Verified against the
 * reference CommonMark implementation, every entry, before this was written.
 */
function renderIndex(entries) {
  return entries.map((e) => `- [${e.number} — ${e.title}](./${e.file})`).join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const current = readFileSync(indexPath, "utf8");

  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    console.error(`docs/adr/README.md is missing the ${START} / ${END} markers.`);
    console.error("They mark the region this script owns; everything else is hand-written.");
    process.exit(1);
  }

  const entries = readAdrs();
  const next =
    current.slice(0, start + START.length) +
    "\n\n" +
    renderIndex(entries) +
    "\n\n" +
    current.slice(end);

  if (next === current) {
    console.log(`ADR index is up to date — ${entries.length} records.`);
    return;
  }

  if (check) {
    // Name what changed rather than just failing: the usual cause is a new ADR,
    // and saying which one turns a red build into a one-command fix.
    const listed = new Set([...current.matchAll(/^- \[(\d{4}) /gm)].map((m) => m[1]));
    const missing = entries.filter((e) => !listed.has(e.number));
    const stale = [...listed].filter((n) => !entries.some((e) => e.number === n));
    console.error("docs/adr/README.md is out of date.");
    if (missing.length > 0) {
      console.error(`  Not listed: ${missing.map((e) => `${e.number} (${e.file})`).join(", ")}`);
    }
    if (stale.length > 0) console.error(`  Listed but gone: ${stale.join(", ")}`);
    if (missing.length === 0 && stale.length === 0) {
      console.error("  The entries match, but a title or filename has changed.");
    }
    console.error("\nRun `pnpm adr:index` and commit the result.");
    process.exit(1);
  }

  writeFileSync(indexPath, next);
  console.log(`Rebuilt the ADR index — ${entries.length} records.`);
}

main();
