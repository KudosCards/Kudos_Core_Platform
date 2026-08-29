#!/usr/bin/env node
/**
 * HTML entities in JSX text silently eat a space, so this bans them.
 *
 * JSX text is not HTML. When the transform meets an entity inside a text node
 * it splits the node around it, and each fragment is then re-trimmed with the
 * usual "whitespace touching a newline goes away" rule. A fragment that began
 * mid-line — right after a `{expression}` — has its leading space stripped as
 * if it had started on a fresh line, and two words are printed welded together.
 *
 * This is not theoretical. A sweep of the whole app found thirteen of them
 * shipped, including three on the public card page a customer buys from:
 *
 *   "1 contactcan't be posted to."          (Contacts, missing-address banner)
 *   "2 itemson the back won't be printed"   (pre-send check)
 *   "Your wallet balance of £5covers this"  (order detail)
 *   "✓Personalised with each recipient's"   (public /cards/[category]/[slug])
 *
 * Nothing catches these: they lint, they typecheck, they build, and the tests
 * that render those screens pass, because the assertions match on substrings
 * that happen to sit on the other side of the missing space. Only reading the
 * rendered sentence reveals it — which is exactly what nobody does on a line of
 * copy they didn't just write.
 *
 * The fix is to write the character, not the entity: ’ for an apostrophe, “ ”
 * for quotes, & for an ampersand. They render identically, they are what the
 * copy means, and they cannot be split. `&lt;` and `&gt;` are allowed because
 * a bare `<` or `>` in JSX text has no literal spelling.
 *
 * The second check covers those two: an allowed entity in the shape that loses
 * a space (a text node starting mid-line, spanning lines) is still rejected —
 * write it as {"<"} there instead.
 *
 * Usage: node scripts/check-jsx-text.mjs   (or: pnpm test)
 */
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(webRoot, "src");

/** `<` and `>` have no literal spelling inside JSX text, so they stay entities. */
const ALLOWED = new Set(["&lt;", "&gt;"]);
const ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** What to write instead, for the entities the app actually used. */
const SUGGESTED = {
  "&apos;": "’",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&quot;": "“ or ”",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&amp;": "&",
  "&nbsp;": 'a non-breaking space, or {"\\u00a0"}',
};

function tsxFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") found.push(...tsxFiles(path));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * True when this text node is the shape that loses a space: it starts mid-line
 * (leading whitespace with no newline in it, i.e. straight after a `}` or `>`)
 * and runs on to another line.
 */
function losesLeadingSpace(raw) {
  return /^[ \t]+[^\n\t ]/.test(raw) && raw.includes("\n");
}

const banned = [];
const risky = [];

for (const file of tsxFiles(srcDir)) {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      const raw = source.slice(node.getFullStart(), node.getEnd());
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const where = `${relative(webRoot, file)}:${line}`;
      for (const match of raw.match(ENTITY) ?? []) {
        if (!ALLOWED.has(match)) banned.push({ where, entity: match });
        else if (losesLeadingSpace(raw)) risky.push({ where, entity: match });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

if (banned.length > 0) {
  console.error(`\n${banned.length} HTML entit(ies) in JSX text:`);
  for (const { where, entity } of banned) {
    const fix = SUGGESTED[entity];
    console.error(`  ✗ ${where}  ${entity}${fix ? `  → write ${fix}` : ""}`);
  }
  console.error("\nWrite the character itself. An entity here can silently drop a space.");
}

if (risky.length > 0) {
  console.error(`\n${risky.length} allowed entit(ies) in a text node that will lose its space:`);
  for (const { where, entity } of risky) {
    console.error(`  ✗ ${where}  ${entity}  → write {"${entity === "&lt;" ? "<" : ">"}"} instead`);
  }
  console.error(
    "\nThis node starts mid-line and runs on, so the entity splits off its leading space.",
  );
}

if (banned.length > 0 || risky.length > 0) process.exit(1);

console.log("No HTML entities in JSX text.");
