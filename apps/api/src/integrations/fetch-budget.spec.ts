import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONTACTS_FETCH_BUDGET_MS, startFetchBudget } from "./fetch-budget";

describe("startFetchBudget", () => {
  it("is not expired before the budget runs out", () => {
    let clock = 1_000;
    const budget = startFetchBudget(5_000, () => clock);
    expect(budget.expired()).toBe(false);
    clock += 4_999;
    expect(budget.expired()).toBe(false);
  });

  it("expires once the budget is spent", () => {
    let clock = 1_000;
    const budget = startFetchBudget(5_000, () => clock);
    clock += 5_000;
    expect(budget.expired()).toBe(true);
  });

  it("bounds a pull well below what the retries alone allow", () => {
    // HubSpot's fifty pages, each retried up to four times with backoff capped
    // at 30s, is an arithmetic ceiling near fifty minutes on a request the
    // customer is waiting on. Whatever this number becomes, it has to stay a
    // small fraction of that or it is not bounding anything.
    expect(CONTACTS_FETCH_BUDGET_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});

/**
 * A guard, not a unit test.
 *
 * The budget only bounds a pull if the loop actually asks it. There are three
 * provider clients with the same shape and there will be more, and the next one
 * gets written by copying one of these — so the rule is mechanical rather than
 * remembered, the same way `no-bare-fetch` handles the per-request deadline.
 */
const CLIENTS = join(__dirname);
/** A paging loop: a `for` whose bound is one of the MAX_PAGES constants. */
const PAGING_LOOP = /for\s*\([^)]*_MAX_PAGES[^)]*\)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("every contacts paging loop is bounded in time", () => {
  const loops = sourceFiles(CLIENTS).flatMap((path) =>
    (readFileSync(path, "utf8").match(PAGING_LOOP) ?? []).map((loop) => ({
      file: path.slice(CLIENTS.length + 1),
      loop,
    })),
  );

  it("finds the paging loops — a broken pattern would make this vacuous", () => {
    expect(loops.length).toBeGreaterThanOrEqual(3);
  });

  it.each(loops.map((l) => [l.file, l.loop]))("%s checks the budget", (_file, loop) => {
    expect(loop).toContain("budget.expired()");
  });
});
