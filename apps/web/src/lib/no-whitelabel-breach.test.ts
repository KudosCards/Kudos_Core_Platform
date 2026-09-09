import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard, not a unit test.
 *
 * GoHighLevel is sold white-label: an agency resells it to its clients under
 * its own branding, and a Location user may know the product only as "Acme
 * CRM". Their marketplace therefore refuses any app that shows a HighLevel
 * reference to that user — it is what our listing was rejected for, and their
 * redirect-URL field had already refused the same string once (ADR 0156).
 *
 * The rule is drawn where the policy is: **how the name is written.**
 *
 *   "GoHighLevel", "HighLevel", "High Level"  → display text. Forbidden.
 *   `gohighlevel`                             → an identifier. Allowed.
 *
 * The all-lower-case, unspaced token is the internal provider key — the stored
 * `provider` value, the connector prop, the API path segment — and is never
 * rendered to anyone. Renaming *that* is a bigger change with a data migration
 * behind it, deliberately deferred; see ADR 0234. Anything with a capital or a
 * space in it is prose, and prose is what a Location user reads.
 *
 * Comments are stripped first: an explanation of *why* this rule exists has to
 * be able to name the thing.
 *
 * Four separate label maps spelled this name before this existed. A rule
 * carried by one of them would have been re-broken by the next.
 */
const ANY_SPELLING = /(go)?\s*high\s*level/gi;

/**
 * Prose or identifier? Identifiers keep one case throughout — `gohighlevel` the
 * provider key, `GOHIGHLEVEL_CLIENT_ID` the env var. Prose mixes case or puts a
 * space in, and prose is what a person reads.
 */
function isDisplayText(match: string): boolean {
  const squashed = match.replace(/\s+/g, "");
  return (
    /\s/.test(match) || (squashed !== squashed.toLowerCase() && squashed !== squashed.toUpperCase())
  );
}

function breaches(source: string): boolean {
  return (source.match(ANY_SPELLING) ?? []).some(isDisplayText);
}

const SRC = join(__dirname, "..");

/** Prose is not a breach: a comment saying why we avoid the name is not the
 *  name being shown to anyone. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("the web app shows no HighLevel reference", () => {
  const files = sourceFiles(SRC);

  it("scans a real tree — a broken walk would make the guard vacuous", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("names the CRM by its white-label name everywhere it is rendered", () => {
    const offenders = files
      .filter((path) => breaches(withoutComments(readFileSync(path, "utf8"))))
      .map((path) => path.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it("would notice the spellings a person actually writes", () => {
    // Without this, a broken pattern would let the guard pass for ever while
    // the name went back on screen.
    expect(breaches('name="GoHighLevel"')).toBe(true);
    expect(breaches("HighLevel CRM")).toBe(true);
    expect(breaches("connect your High Level account")).toBe(true);
    expect(breaches("Sent to Highlevel")).toBe(true);
    // The internal slug is an identifier, not something anyone reads.
    expect(breaches('provider="gohighlevel"')).toBe(false);
    expect(breaches('config.get("GOHIGHLEVEL_CLIENT_ID")')).toBe(false);
    expect(breaches('const p = "leadconnector";')).toBe(false);
    // And the rule must not fire on unrelated prose.
    expect(breaches("a high level of care")).toBe(true); // deliberately strict
  });
});
