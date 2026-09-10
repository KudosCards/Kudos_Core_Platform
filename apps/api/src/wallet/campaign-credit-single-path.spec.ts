import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard, not a unit test.
 *
 * `creditCampaign` is where every rule about campaign money lives: one credit
 * per account ever, the half-open window, and the budget ceiling — all read and
 * written inside a single serializable transaction, because anything checked
 * outside it lets two concurrent signups both take the last £5. None of that is
 * enforced by the schema. A second path that writes a `campaign` ledger row
 * directly would be correct-looking, would pass its own tests, and would quietly
 * have none of it.
 *
 * So the rule is mechanical: the wallet ledger has a known, short list of
 * writers, and only one of them may write a campaign credit.
 *
 * See docs/wallet-campaigns-plan.md (D4, D5).
 */
const SRC = join(__dirname, "..");

/**
 * Every file allowed to write a wallet ledger row, and why.
 *
 * A new entry here is not forbidden — it is a decision. The balance is a plain
 * SUM over this table (ADR 0012), so a writer that gets the sign or the
 * `balanceAfterMinor` wrong corrupts a customer's money with no error anywhere.
 */
const LEDGER_WRITERS: Record<string, string> = {
  "wallet/wallet.service.ts": "top-ups, hand adjustments, order payment, and campaign credits",
  "batch-orders/batch-orders.service.ts": "charging and refunding an order against the balance",
};

/** The only file that may write a credit of type `campaign`. */
const CAMPAIGN_WRITER = "wallet/wallet.service.ts";

/** A write to the ledger, however it is reached — Prisma or raw SQL. */
const LEDGER_WRITE =
  /walletLedgerEntry\s*\.\s*(?:create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(|INSERT\s+INTO\s+"?wallet_ledger_entries"?/i;

/** The start of a Prisma ledger write, up to and including its opening paren. */
const LEDGER_WRITE_CALL =
  /walletLedgerEntry\s*\.\s*(?:create|createMany|upsert|update|updateMany)\s*\(/g;

/** The campaign entry type. */
const CAMPAIGN_TYPE = /\btype\s*:\s*["'`]campaign["'`]/;

/**
 * The argument text of every ledger write in a file.
 *
 * Scanned by matching parentheses rather than by taking a fixed slice, because
 * the thing being looked for — the entry type — sits at the top of a nested
 * object and a fixed window either cuts it off or runs into the next call.
 * `where: { type: "campaign" }` on a *read* is not a write and must not be
 * mistaken for one; a guard that cries wolf gets deleted.
 */
function ledgerWrites(source: string): string[] {
  const bodies: string[] = [];
  for (const match of source.matchAll(LEDGER_WRITE_CALL)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      if (source[index] === "(") depth += 1;
      else if (source[index] === ")") depth -= 1;
      index += 1;
    }
    bodies.push(source.slice(start, index - 1));
  }
  return bodies;
}

/** Prose is not code: a doc comment explaining the campaign entry type is not a
 *  write, and a guard that can't tell the difference gets suppressed rather
 *  than obeyed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("the wallet ledger", () => {
  const files = sourceFiles(SRC).map((path) => ({
    name: path.slice(SRC.length + 1),
    source: withoutComments(readFileSync(path, "utf8")),
  }));

  it("is written by the files that are supposed to write it, and no others", () => {
    const writers = files.filter((file) => LEDGER_WRITE.test(file.source)).map((file) => file.name);
    expect(writers.sort()).toEqual(Object.keys(LEDGER_WRITERS).sort());
  });

  it("only ever writes a campaign credit from creditCampaign", () => {
    const offenders = files
      .filter((file) => file.name !== CAMPAIGN_WRITER)
      .filter((file) => ledgerWrites(file.source).some((body) => CAMPAIGN_TYPE.test(body)))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it("has the rules creditCampaign is trusted to apply", () => {
    // If any of these leaves `creditCampaign`, the guard above is protecting a
    // path that no longer does the work — so pin them here rather than trusting
    // the file name.
    const source = readFileSync(join(SRC, CAMPAIGN_WRITER), "utf8");
    const credit = source.slice(source.indexOf("async creditCampaign("));
    expect(credit).toContain("runSerializable");
    expect(credit).toContain("CAMPAIGN_REFERENCE_PREFIX");
    expect(credit).toContain("budget_exhausted");
  });

  it("would notice either mistake — the patterns are the ones callers write", () => {
    // Proves the guards above can fail. Without this, a broken pattern would
    // let them pass forever while a second path wrote campaign money.
    expect(LEDGER_WRITE.test("      await tx.walletLedgerEntry.create({")).toBe(true);
    expect(LEDGER_WRITE.test("await this.prisma.walletLedgerEntry.createMany({ data })")).toBe(
      true,
    );
    expect(LEDGER_WRITE.test('INSERT INTO "wallet_ledger_entries" (account_id)')).toBe(true);
    expect(CAMPAIGN_TYPE.test('        type: "campaign",')).toBe(true);
    // And that they don't fire on the things that merely mention a campaign.
    expect(LEDGER_WRITE.test("const entries = await tx.walletLedgerEntry.findMany({")).toBe(false);
    expect(CAMPAIGN_TYPE.test('kind: "wallet_campaign_live",')).toBe(false);

    // The paren scan reaches a type nested two objects deep, and stops before
    // the next call — a read of campaign entries is not a write of one.
    const sample = `
      await tx.walletLedgerEntry.create({ data: { accountId, type: "campaign" } });
      const total = await this.prisma.walletLedgerEntry.aggregate({
        where: { type: "campaign" },
      });
    `;
    expect(ledgerWrites(sample)).toHaveLength(1);
    expect(ledgerWrites(sample).filter((body) => CAMPAIGN_TYPE.test(body))).toHaveLength(1);
    expect(
      ledgerWrites('await tx.walletLedgerEntry.create({ data: { type: "topup" } });').filter(
        (body) => CAMPAIGN_TYPE.test(body),
      ),
    ).toEqual([]);
  });
});
