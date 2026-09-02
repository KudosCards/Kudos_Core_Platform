import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard, not a unit test.
 *
 * An occasion's `type` does not say who created it. `birthday`, `anniversary`
 * and `renewal` are written by three different producers against the same
 * contact — the rolling per-recipient scheduler, a shared event, and a one-off
 * a customer adds by hand — and only `source` tells them apart.
 *
 * Selecting on `type` alone therefore reaches other people's rows. Twice now
 * that has meant deleting a card somebody had already approved:
 *
 *   - `realignBirthdayOccasion` read every `type: "birthday"` row, ranked a
 *     shared event's cohort card as a rival birthday and discarded it (ADR
 *     0221). It fired on any contact edit, because the contact page sends
 *     `dateOfBirth` on every save.
 *   - `upsertKeyDate` and `deleteKeyDate` cleared every open occasion of the
 *     key date's type, cohort cards included (ADR 0222).
 *
 * Both functions *wrote* `source` on the rows they created and never read it
 * back. That asymmetry is invisible in review and obvious to a scan, which is
 * why this is mechanical rather than remembered.
 */
const ROOT = join(__dirname, "..");

/**
 * Queries that select on `type` without `source`, and why that is right.
 *
 * `promoteDueOccasions` moves rolling occasions into Approvals when they enter
 * the window, and deliberately promotes a shared event's members of those types
 * too — a cohort card still has to be approved before it can be ordered. Adding
 * `source` here would strand them at `scheduled` for ever. That is a decision
 * about the events model, not a scoping fix, and it belongs in a change about
 * the events model.
 *
 * Listed rather than pattern-matched, so an exemption is a decision someone
 * made and can be seen, not a gap.
 */
const EXEMPT: { file: string; provesItInstead?: string }[] = [
  // Promotes rolling occasions into Approvals when they enter the window, and
  // deliberately promotes a shared event's members of those types too — a
  // cohort card still has to be approved before it can be ordered. Adding
  // `source` here would strand them at `scheduled` for ever. That is a decision
  // about the events model, not a scoping fix.
  { file: "promote-due-occasions.util.ts" },
  // Reads every birthday row on purpose. The unique key is
  // (recipientId, type, occasionDate) with no source column, so a cohort card
  // on the corrected date genuinely occupies it: filtering it out of the query
  // would make it an invisible blocker and reintroduce the P2002 ADR 0185
  // removed. The source check moved into the filter over the result rather than
  // disappearing, which `provesItInstead` holds it to. See ADR 0221.
  // The call site, not the helper's name: `isRolling` alone still matches when
  // the definition survives and the call has been deleted, which is exactly
  // the mutation this needs to catch.
  { file: "realign-birthday.util.ts", provesItInstead: "isRolling(o.source)" },
];

/**
 * `type` used as a filter key, written either way.
 *
 * `where: { recipientId, type, status }` is object shorthand and was how both
 * key-date deletes were written — a pattern keyed on `type:` alone would have
 * passed the very defect this exists to catch, which is what the sample in the
 * last case here pins.
 */
const TYPE_KEY = /\btype\s*[,:}]/;

/** Prisma query methods that take a `where`. */
const QUERY = [
  "findMany",
  "findFirst",
  "findUnique",
  "deleteMany",
  "updateMany",
  "count",
  "aggregate",
  "groupBy",
].join("|");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith(".ts") && !entry.includes(".spec.")) out.push(path);
  }
  return out;
}

/** The text of `{ … }` starting at the brace at `open`, nesting included. */
function balanced(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/**
 * Every occasion query's `where` clause.
 *
 * The `where` specifically, not the whole argument: `select: { type: true }`
 * asks for the column rather than filtering on it, and a scan that cannot tell
 * those apart reports rows nobody needs to look at. An exemption list padded
 * with false positives is how a guard stops being read.
 */
export function occasionWhereClauses(source: string): { method: string; where: string }[] {
  const found: { method: string; where: string }[] = [];
  const call = new RegExp(String.raw`\bocca(?:s)?ion\.(${QUERY})\(\{`, "g");
  for (let match = call.exec(source); match !== null; match = call.exec(source)) {
    const args = balanced(source, match.index + match[0].length - 1);
    const whereAt = args.search(/\bwhere:\s*\{/);
    if (whereAt === -1) continue;
    found.push({
      method: match[1]!,
      where: balanced(args, args.indexOf("{", whereAt)),
    });
  }
  return found;
}

describe("occasion queries that select on type", () => {
  const files = sourceFiles(ROOT).map((path) => ({
    path,
    clauses: occasionWhereClauses(readFileSync(path, "utf8")),
  }));

  it("finds the queries (a sanity check on the scan itself)", () => {
    // If this drops to zero the assertion below passes vacuously.
    const total = files.reduce((sum, file) => sum + file.clauses.length, 0);
    expect(total).toBeGreaterThanOrEqual(10);
  });

  it("names the source on every one", () => {
    const offenders = files
      .filter((file) => !EXEMPT.some((entry) => file.path.endsWith(entry.file)))
      .flatMap((file) =>
        file.clauses
          .filter((clause) => TYPE_KEY.test(clause.where))
          .filter((clause) => !/\bsource\b/.test(clause.where))
          .map(
            (clause) =>
              `${file.path.slice(ROOT.length + 1)} ${clause.method}: ` +
              clause.where.replace(/\s+/g, " ").slice(0, 120),
          ),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps each exemption honest", () => {
    // An exemption for a query that no longer exists is a hole nobody notices —
    // and one whose reasoning has quietly been deleted is worse, because the
    // list still reads as considered.
    for (const entry of EXEMPT) {
      const file = files.find((candidate) => candidate.path.endsWith(entry.file));
      expect(file).toBeDefined();
      const unscoped = file!.clauses.filter(
        (clause) => TYPE_KEY.test(clause.where) && !/\bsource\b/.test(clause.where),
      );
      expect(unscoped.length).toBeGreaterThan(0);
      if (entry.provesItInstead) {
        // The exemption says the check moved rather than went away. Hold it to
        // that: if the in-memory filter is deleted, the exemption stops being
        // true and this fails.
        expect(readFileSync(file!.path, "utf8")).toContain(entry.provesItInstead);
      }
    }
  });

  it("reads the where, not the select", () => {
    // The distinction the exemption list depends on: asking for the column is
    // not filtering on it.
    const sample = `
      await this.prisma.occasion.findMany({
        where: { accountId, status: "scheduled" },
        select: { type: true, occasionDate: true },
      });
    `;
    const [clause] = occasionWhereClauses(sample);
    expect(clause).toBeDefined();
    expect(TYPE_KEY.test(clause!.where)).toBe(false);
  });

  it("can tell a scoped query from an unscoped one", () => {
    // Proves the scan can fail rather than only ever passing.
    const sample = `
      await tx.occasion.deleteMany({ where: { recipientId, type, status: "scheduled" } });
      await tx.occasion.deleteMany({ where: { recipientId, type, source: { in: rolling } } });
    `;
    const clauses = occasionWhereClauses(sample);
    expect(clauses).toHaveLength(2);
    expect(
      clauses.filter((c) => TYPE_KEY.test(c.where) && !/\bsource\b/.test(c.where)),
    ).toHaveLength(1);
  });
});
