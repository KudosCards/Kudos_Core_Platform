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
 * The budget only bounds a pull if the loop actually asks it. There are four
 * paging loops with the same shape and there will be more, and the next one
 * gets written by copying one of these — so the rule is mechanical rather than
 * remembered, the same way `no-bare-fetch` handles the per-request deadline.
 *
 * Scans the whole API source, not one folder. It used to scan `__dirname` back
 * when this file lived beside the three CRM clients, and moving it to `common/`
 * silently emptied the scan — caught only because the vacuity check below
 * exists, which is the entire argument for having one. Widening it then found
 * a loop nobody had counted: the Stripe invoice backfill. See ADR 0238.
 */
const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

/**
 * Every `for` loop whose bound is one of the MAX_PAGES constants, header and
 * body together.
 *
 * Parens are balanced rather than pattern-matched. A `[^)]*` header pattern
 * stops at the first `)`, which inside `!budget.expired()` is the wrong one —
 * so the CRM clients only ever matched a truncated header that happened to
 * contain the very call being looked for. It passed for a reason unrelated to
 * the rule.
 *
 * And the body is included because header-only encoded one shape rather than
 * the rule. The three CRM clients put `&& !budget.expired()` in the condition;
 * the catalog pull throws on expiry and the invoice backfill records
 * `truncated`, and neither can say that from a `for` condition. A header scan
 * called those two unbounded while they were the loops consulting the budget
 * most carefully. The rule is: the loop consults the budget somewhere.
 *
 * See ADR 0238.
 */
function pagingLoops(source: string): string[] {
  const found: string[] = [];
  const balancedEnd = (from: number, open: string, close: string): number => {
    let depth = 0;
    for (let i = from; i < source.length; i += 1) {
      if (source[i] === open) depth += 1;
      else if (source[i] === close) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  };

  const starts = /\bfor\s*\(/g;
  for (let m = starts.exec(source); m !== null; m = starts.exec(source)) {
    const headerEnd = balancedEnd(source.indexOf("(", m.index), "(", ")");
    if (headerEnd < 0) continue;
    const header = source.slice(m.index, headerEnd + 1);
    if (!header.includes("MAX_PAGES")) continue;
    const brace = source.indexOf("{", headerEnd);
    const bodyEnd = brace < 0 ? -1 : balancedEnd(brace, "{", "}");
    found.push(bodyEnd < 0 ? header : source.slice(m.index, bodyEnd + 1));
  }
  return found;
}

describe("every paging loop is bounded in time", () => {
  const loops = sourceFiles(SRC).flatMap((path) =>
    pagingLoops(readFileSync(path, "utf8")).map((loop) => ({
      file: path.slice(SRC.length + 1),
      loop,
    })),
  );

  it("finds the paging loops — a broken pattern would make this vacuous", () => {
    expect(loops.length).toBeGreaterThanOrEqual(4);
  });

  it.each(loops.map((l) => [l.file, l.loop]))("%s checks the budget", (_file, loop) => {
    expect(loop).toContain("budget.expired()");
  });

  it("can tell a bounded loop from an unbounded one", () => {
    // Proves the scan can fail rather than only ever passing — and that it sees
    // a budget checked in the body, not only in the condition.
    const sample = `
      for (let page = 0; page < MAX_PAGES; page += 1) { await pull(); }
      for (let page = 0; page < MAX_PAGES; page += 1) { if (budget.expired()) break; await pull(); }
    `;
    const found = pagingLoops(sample);
    expect(found).toHaveLength(2);
    expect(found.filter((loop) => loop.includes("budget.expired()"))).toHaveLength(1);
  });
});
