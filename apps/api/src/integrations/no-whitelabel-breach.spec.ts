import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CRM_PROVIDER_LABELS, crmProviderLabel } from "@kudos/shared-types";
import { SUPPORTED_PROVIDERS } from "./crm-connections.service";

/**
 * A guard, not a unit test — the API half of the web app's
 * `no-whitelabel-breach`. See ADR 0234.
 *
 * GoHighLevel is sold white-label, so their marketplace refuses an app that
 * shows a HighLevel reference to a Location user. The API contributes to that
 * surface through the messages it throws: an exception message here is rendered
 * verbatim on the customer's screen.
 *
 * The rule is narrower than the web's, because the API legitimately keeps the
 * name in code that nobody reads — `GoHighLevelContact`, `mapGoHighLevelContact`,
 * the `gohighlevel/` directory. Those are identifiers. **A string literal is
 * not**: it is either shown to someone or logged where it may be. So string
 * literals are what this checks.
 */
const ANY_SPELLING = /(go)?\s*high\s*level/gi;
/** Quoted text of any of the three kinds TypeScript offers. */
const STRING_LITERAL = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

const SRC = join(__dirname, "..");

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

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

/** A literal breaches when any occurrence in it is display text — `"gohighlevel"`
 *  the provider key and `"GOHIGHLEVEL_CLIENT_ID"` the env var are not. */
function breachingLiterals(source: string): string[] {
  return (withoutComments(source).match(STRING_LITERAL) ?? []).filter((literal) =>
    (literal.match(ANY_SPELLING) ?? []).some(isDisplayText),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("no API string a customer can read names HighLevel", () => {
  const files = sourceFiles(SRC);

  it("scans a real tree — a broken walk would make the guard vacuous", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith("crm-connections.service.ts"))).toBe(true);
  });

  it("finds no such string", () => {
    const offenders = files.flatMap((path) =>
      breachingLiterals(readFileSync(path, "utf8")).map(
        (literal) => `${path.slice(SRC.length + 1)}: ${literal}`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("would notice a message that named it, and leaves identifiers alone", () => {
    expect(breachingLiterals('throw new Error("GoHighLevel rejected the token");')).toHaveLength(1);
    expect(breachingLiterals("const m = `HighLevel said ${x}`;")).toHaveLength(1);
    // Identifiers and the internal provider key are not references.
    expect(breachingLiterals("export type GoHighLevelContact = { id: string };")).toEqual([]);
    expect(breachingLiterals('const p = "gohighlevel";')).toEqual([]);
    expect(breachingLiterals('config.get("GOHIGHLEVEL_CLIENT_ID")')).toEqual([]);
    expect(breachingLiterals("function mapGoHighLevelContact() {}")).toEqual([]);
  });
});

/**
 * The breach a source scan cannot see.
 *
 * `crmProviderLabel` falls back to capitalising an unknown slug, which is right
 * for a CRM we have not met and wrong for this one: `gohighlevel` would come
 * back "Gohighlevel" and render, and no guard above could find it because that
 * string is never written down anywhere. The fallback is only safe while every
 * provider we actually support has an explicit label.
 */
describe("every supported provider has an explicit label", () => {
  it.each(SUPPORTED_PROVIDERS)("%s", (provider) => {
    expect(CRM_PROVIDER_LABELS[provider]).toBeDefined();
  });

  it("and none of those labels names HighLevel", () => {
    const shown = SUPPORTED_PROVIDERS.map((p) => crmProviderLabel(p));
    expect(shown.filter((label) => /high\s*level/i.test(label))).toEqual([]);
  });

  it("labels the public OAuth slug too — it is what the redirect carries", () => {
    // The browser comes back with ?connected=leadconnector, and the page runs
    // that through the same map. Without an entry the fallback would render
    // "Leadconnector".
    expect(CRM_PROVIDER_LABELS.leadconnector).toBe("LeadConnector");
  });
});
