import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard, not a unit test.
 *
 * The external review's one unqualified pass was tenant isolation: "no IDOR
 * found — every account-scoped service consistently uses `findFirst({ where: {
 * id, accountId } })` or scopes the mutation via `updateMany`/`deleteMany` with
 * `accountId`". That consistency is the whole defence, and it is the kind that
 * decays one query at a time.
 *
 * The occasion-reconcile guard added in #383 broke it: its `updateMany` names
 * the account, the `findMany` that works out which occasions were lost does
 * not. The ids come from the caller's own recipients, so nothing is reachable
 * today — which is exactly why an argument is worth less here than a check.
 * See ADR 0215.
 */
const SOURCE = join(__dirname, "batch-orders.service.ts");

/**
 * Reads that don't name the account, and why.
 *
 * `settleFulfillment` takes only a transaction and a batch-order id — there is
 * no account in scope to name, and threading one through the Stripe settlement
 * path is a change worth making deliberately rather than as a side effect of an
 * audit. Its ids come from that order's own recipients, which is the same
 * argument the reconcile read used to make; the difference is that the
 * reconcile had an account in scope and simply didn't use it.
 *
 * Listed rather than pattern-matched, so an exemption is a decision someone
 * made and can be seen, not a gap.
 */
const EXEMPT = ["supersedesOccasionId"];

/** Each `occasion.<read>({ … })` call in the file, with its argument text. */
function occasionReads(source: string): { action: string; args: string }[] {
  const found: { action: string; args: string }[] = [];
  const pattern = /\bocca(?:s)?ion\.(findMany|findFirst|findUnique|count|aggregate)\(\{/g;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    // Walk the braces from the opening one so nested objects come along whole.
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (let i = end; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    found.push({ action: match[1]!, args: source.slice(match.index, end + 1) });
  }
  return found;
}

describe("batch-orders occasion reads", () => {
  const source = readFileSync(SOURCE, "utf8");
  const reads = occasionReads(source);

  it("finds the reads (a sanity check on the scan itself)", () => {
    // If this drops to zero the assertion below passes vacuously.
    expect(reads.length).toBeGreaterThanOrEqual(3);
  });

  it("names the account on every one", () => {
    const unscoped = reads
      .filter((read) => !EXEMPT.some((marker) => read.args.includes(marker)))
      .filter((read) => !/\baccountId\b/.test(read.args))
      .map((read) => `${read.action}: ${read.args.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(unscoped).toEqual([]);
  });

  it("keeps the exemption honest — it must still match a real read", () => {
    // An exemption for a query that no longer exists is a hole nobody notices.
    for (const marker of EXEMPT) {
      expect(reads.some((read) => read.args.includes(marker))).toBe(true);
    }
  });

  it("can tell a scoped read from an unscoped one", () => {
    // Proves the scan can fail rather than only ever passing.
    const sample = `
      await tx.occasion.findMany({ where: { id: { in: ids }, status: "approved" } });
      await tx.occasion.findMany({ where: { id: { in: ids }, accountId, status: "approved" } });
    `;
    const parsed = occasionReads(sample);
    expect(parsed).toHaveLength(2);
    expect(parsed.filter((r) => !/\baccountId\b/.test(r.args))).toHaveLength(1);
  });
});
