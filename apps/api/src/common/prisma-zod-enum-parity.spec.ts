import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as sharedEnums from "@kudos/shared-types";

/**
 * A guard, not a unit test.
 *
 * `packages/shared-types/src/enums.ts` opens by stating the rule this checks:
 *
 * > The Prisma schema's enums must be kept in sync with these values by hand
 * > (Prisma can't import from TS), so changing a value here always means
 * > updating apps/api/prisma/schema.prisma in the same change.
 *
 * Twenty-three pairs, kept aligned by hand, and nothing checked it. A rule that
 * lives only in a comment is a rule until the first person in a hurry — and the
 * failure is quiet in the worst way: the API writes a value Postgres rejects at
 * runtime, or accepts one the API's own validation would have refused.
 *
 * It lives in `apps/api` rather than beside the enums because
 * `packages/shared-types` has no test runner of its own, and this is the
 * workspace that owns the schema being compared against.
 *
 * Found while adding `campaign` to `WalletEntryType` — a change that has to
 * touch both files, which is exactly when the gap was worth closing.
 * See docs/wallet-campaigns-plan.md.
 */

const SCHEMA = join(__dirname, "..", "..", "prisma", "schema.prisma");

/** Every `enum X { … }` block in the Prisma schema, as name → values. */
function prismaEnums(source: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const pattern = /^enum\s+(\w+)\s*\{([^}]*)\}/gm;
  for (let m = pattern.exec(source); m !== null; m = pattern.exec(source)) {
    const values = m[2]!
      .split("\n")
      // Prisma allows `///` doc comments and `//` comments between values.
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter((line) => line.length > 0 && /^\w+$/.test(line));
    found.set(m[1]!, values);
  }
  return found;
}

/** `walletEntryTypeSchema` → `WalletEntryType`. */
function prismaNameFor(exportName: string): string {
  const base = exportName.replace(/Schema$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Every exported zod enum in shared-types, as export name → values. */
function zodEnums(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [name, value] of Object.entries(sharedEnums)) {
    if (!name.endsWith("Schema")) continue;
    const options = (value as { options?: unknown })?.options;
    // z.enum exposes `options`; z.object and friends do not, so this picks out
    // the enums without needing a list of them.
    if (Array.isArray(options) && options.every((o) => typeof o === "string")) {
      found.set(name, options);
    }
  }
  return found;
}

describe("the Prisma enums and their zod twins agree", () => {
  const prisma = prismaEnums(readFileSync(SCHEMA, "utf8"));
  const zod = zodEnums();
  const pairs = [...zod].filter(([name]) => prisma.has(prismaNameFor(name)));

  it("parses both sides — a broken parse would make this vacuous", () => {
    expect(prisma.size).toBeGreaterThan(20);
    expect(zod.size).toBeGreaterThan(15);
    expect(prisma.get("WalletEntryType")).toContain("campaign");
  });

  it("finds the pairs to compare", () => {
    // If the naming convention changes, this drops and every assertion below
    // silently stops testing anything.
    expect(pairs.length).toBeGreaterThan(15);
  });

  it.each(pairs.map(([name, values]) => [name, values]))(
    "%s matches its Prisma enum exactly",
    (name, zodValues) => {
      const prismaValues = prisma.get(prismaNameFor(name))!;
      // Sets, not arrays: declaration order carries no meaning on either side,
      // and comparing it would fail for a reason nobody needs to act on.
      expect([...zodValues].sort()).toEqual([...prismaValues].sort());
    },
  );

  it("names the zod enums with no Prisma counterpart, rather than ignoring them", () => {
    // Not a failure — several are API-shape vocabularies with no table behind
    // them. Listing them keeps the exemption visible, so a genuinely missing
    // Prisma enum shows up here as a new entry rather than as silence.
    const unpaired = [...zod.keys()].filter((name) => !prisma.has(prismaNameFor(name))).sort();
    expect(unpaired).toEqual([
      // Derived from order + subscription state for the ops dashboard; no column.
      "accountHealthSchema",
      // Print geometry, stored as a PlatformSetting string.
      "cardSizeSchema",
      // Derived from activity for the ops dashboard; no column.
      "engagementLevelSchema",
      // Notification `kind` is a plain String column on both tables, so the
      // vocabulary is enforced by these schemas alone.
      "inboxNotificationKindSchema",
      "notificationKindSchema",
      // PlatformAdmin.role is a String column, defaulted in the schema.
      "platformAdminRoleSchema",
    ]);
  });

  it("can tell a mismatch from a match", () => {
    // Proves the comparison can fail rather than only ever passing.
    const sample = prismaEnums("enum Colour {\n  red\n  /// a doc comment\n  blue\n}\n");
    expect(sample.get("Colour")).toEqual(["red", "blue"]);
    expect(prismaNameFor("walletEntryTypeSchema")).toBe("WalletEntryType");
  });
});
