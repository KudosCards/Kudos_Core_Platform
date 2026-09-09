import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";

/**
 * A guard, not a unit test.
 *
 * `sanitize-html` 2.17.6+ reaches a tree of ESM-only packages. Node ≥22.12
 * loads them from CommonJS itself via `require(esm)` — which is why the API
 * runtime needed no change at all — but Jest's own module registry does not, so
 * the suite has to compile them down. Both Jest configs therefore carry a
 * `transformIgnorePatterns` naming the packages to transform.
 *
 * That list is a hand-written enumeration of somebody else's dependency tree,
 * which is the shape that goes stale silently: the next `sanitize-html` release
 * adds one ESM package and the suite fails with "Unexpected token 'export'"
 * pointing at a file nobody in this repo has heard of. Worse, the list was
 * discovered by running the suite and reading the error, one package at a time
 * — htmlparser2, then domelementtype, then nanoid — which is not a method, it
 * is a symptom.
 *
 * So the closure is recomputed here from what is actually installed, and the
 * lists are checked against it. See ADR 0239.
 */

/** Every package reachable from `sanitize-html`, with its module type. */
function dependencyClosure(from: string): Map<string, string> {
  const seen = new Map<string, string>();
  const walk = (dir: string): void => {
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) return;
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      name: string;
      type?: string;
      dependencies?: Record<string, string>;
    };
    if (seen.has(pkg.name)) return;
    seen.set(pkg.name, pkg.type ?? "commonjs");
    // pnpm lays a package's dependencies out as siblings under the
    // `node_modules` directory that contains it.
    const siblings = dirname(dir);
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      const candidate = join(siblings, dep);
      if (existsSync(candidate)) {
        try {
          walk(realpathSync(candidate));
        } catch {
          /* a broken link is not this guard's business */
        }
      }
    }
  };
  walk(from);
  return seen;
}

/** The package names a `transformIgnorePatterns` entry exempts from being
 *  ignored — i.e. the ones it asks Jest to transform. */
function transformedPackages(patterns: string[]): string[] {
  const names = patterns.flatMap((pattern) => {
    const group = /\(\?:([^)]*)\)@/.exec(pattern);
    return group ? group[1]!.split("|") : [];
  });
  return [...new Set(names)].sort();
}

const API = join(__dirname, "..", "..");

function jestUnitPatterns(): string[] {
  const pkg = JSON.parse(readFileSync(join(API, "package.json"), "utf8")) as {
    jest: { transformIgnorePatterns?: string[] };
  };
  return pkg.jest.transformIgnorePatterns ?? [];
}

function jestE2ePatterns(): string[] {
  const cfg = JSON.parse(readFileSync(join(API, "test", "jest-e2e.json"), "utf8")) as {
    transformIgnorePatterns?: string[];
  };
  return cfg.transformIgnorePatterns ?? [];
}

describe("every ESM dependency the suite loads is transformed", () => {
  const root = realpathSync(dirname(require.resolve("sanitize-html/package.json")));
  const closure = dependencyClosure(root);
  const esmOnly = [...closure]
    .filter(([, type]) => type === "module")
    .map(([name]) => name)
    .sort();

  it("walks a real dependency tree — a broken walk would make this vacuous", () => {
    // sanitize-html has six direct dependencies; anything near one means the
    // walk stopped at the root and the assertions below prove nothing.
    expect(closure.size).toBeGreaterThan(5);
    expect(closure.has("sanitize-html")).toBe(true);
  });

  it("finds ESM packages at all — otherwise the lists are trivially correct", () => {
    // If sanitize-html ever goes back to a CommonJS parser this drops to zero
    // and the whole mechanism can be deleted. Until then, a zero here means the
    // type detection broke, not that the problem went away.
    expect(esmOnly.length).toBeGreaterThan(0);
  });

  it.each([
    ["package.json (unit)", jestUnitPatterns],
    ["test/jest-e2e.json (e2e)", jestE2ePatterns],
  ])("%s names exactly the ESM packages, no more and no fewer", (_label, patterns) => {
    // Not a subset check in either direction. A missing name is a suite that
    // fails on the next install; a stale one is a package being compiled for no
    // reason, and a reader left wondering which of the two problems they have.
    expect(transformedPackages(patterns())).toEqual(esmOnly);
  });

  it("reads the patterns rather than assuming their shape", () => {
    // If the pattern is rewritten in a form this parser cannot read, the
    // extraction silently returns [] and the assertion above would fail loudly
    // rather than pass — but prove the parser works on the real thing.
    expect(transformedPackages(jestUnitPatterns()).length).toBeGreaterThan(0);
    expect(transformedPackages(["^(?!.*\\.pnpm/(?:alpha|beta)@).*node_modules"])).toEqual([
      "alpha",
      "beta",
    ]);
  });
});
