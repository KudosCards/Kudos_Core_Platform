import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard, not a unit test.
 *
 * Every outbound call has to go through `httpRequest` so it gets a deadline —
 * `fetch` has none of its own, and a hung upstream otherwise holds a request (or
 * a nightly cron) open until the socket gives up. This is exactly the kind of
 * omission that creeps back in one client at a time: two catalog call sites had
 * timeouts while eight other clients didn't, purely by accident of who wrote
 * them. So the rule is mechanical rather than remembered.
 */
const SRC = join(__dirname, "..");
const ALLOWED = ["common/http-request.ts"];
/**
 * A call to `fetch`, however it is reached.
 *
 * The optional `<something>.` prefix is the part that was missing. The pattern
 * used to exclude any dotted form outright, so `globalThis.fetch(url, init)` —
 * the way someone writes it when the bare global feels too implicit — sailed
 * past the guard untimed. `fetch` still has to be the whole identifier, so
 * `this.fetchContacts(` and `prefetch(` stay out.
 */
const BARE_FETCH = /(?<![\w$])(?:[\w$]+(?:\.[\w$]+)*\.)?fetch\s*\(/;

/** Prose is not code: a doc comment reading "Injectable fetch (defaults to the
 * global)" is not a call site, and a guard that can't tell the difference gets
 * suppressed rather than obeyed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("outbound HTTP", () => {
  it("goes through httpRequest everywhere, so nothing is left untimed", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => !ALLOWED.some((allowed) => path.endsWith(allowed)))
      .filter((path) => BARE_FETCH.test(withoutComments(readFileSync(path, "utf8"))))
      .map((path) => path.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it("would notice a bare fetch — the pattern it looks for is the one callers write", () => {
    // Proves the guard above can fail: without this, a broken pattern would let
    // it pass forever while every call site went untimed.
    expect(BARE_FETCH.test('const response = await fetch(url, { method: "POST" });')).toBe(true);
    expect(BARE_FETCH.test("  const r = fetch(`${base}/thing`);")).toBe(true);
    // Reached through an object, which is how it gets written when the bare
    // global feels too implicit — and which the guard used to wave through.
    expect(BARE_FETCH.test("const r = await globalThis.fetch(url, init);")).toBe(true);
    expect(BARE_FETCH.test("return window.fetch(url);")).toBe(true);
    // Not our concern: a method named fetch on something else.
    expect(BARE_FETCH.test("await this.fetchContacts(token);")).toBe(false);
    expect(BARE_FETCH.test("const x = prefetch(url);")).toBe(false);
    // A reference, not a call — this is how the global is injected for tests.
    expect(BARE_FETCH.test("const impl = options.fetchImpl ?? globalThis.fetch;")).toBe(false);
  });

  it("ignores comments but not code", () => {
    expect(withoutComments("/** Injectable fetch (defaults to the global). */")).not.toMatch(
      BARE_FETCH,
    );
    expect(withoutComments("// call fetch(url) here one day")).not.toMatch(BARE_FETCH);
    expect(withoutComments('const r = await fetch("/x"); // fine')).toMatch(BARE_FETCH);
  });

  it("scans a real tree — a broken walk would make the guard vacuous", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("common/http-request.ts"))).toBe(true);
  });
});
