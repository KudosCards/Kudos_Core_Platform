import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every `Sentry.init` in this app must install the scrubbers.
 *
 * The scrubbers themselves are well tested; what nothing tested was that they
 * are *wired in*. There are three runtimes here — browser, Node and edge — each
 * with its own init, and the whole finding was that all three shipped without
 * any redaction while the API had it. A fourth runtime, or a fifth, would be
 * added by copying one of these files, and copying the wrong one costs nothing
 * until a token turns up in an error report. See ADR 0228.
 *
 * Deliberately a source-text check rather than a runtime one: these files run
 * once at process start, guarded on a DSN that is absent in test, so there is
 * no seam to assert against without pretending to be Next's instrumentation.
 */
const SENTRY_INIT = /Sentry\.init\(/;

describe("every Sentry init installs the scrubbers", () => {
  const srcRoot = join(__dirname, "..");
  const initFiles = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => join(srcRoot, entry))
    .filter((file) => SENTRY_INIT.test(readFileSync(file, "utf8")));

  it("finds the three runtime inits — browser, Node and edge", () => {
    // If this drops below three, an init was removed or renamed and the loop
    // below would pass by testing nothing.
    expect(initFiles.length).toBeGreaterThanOrEqual(3);
  });

  it.each(initFiles)("%s scrubs events and breadcrumbs", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("beforeSend: scrubEvent");
    expect(source).toContain("beforeBreadcrumb: scrubBreadcrumb");
  });
});
