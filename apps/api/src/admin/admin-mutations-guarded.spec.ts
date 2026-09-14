import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every mutating route on the platform-settings controllers is super-admin only.
 *
 * ADR 0040: "Super admin manages the operator team and platform settings."
 * `ops` is the schema default and the role every invited operator starts on.
 * Six of ten mutations said so and four did not, so an ops operator could
 * rewrite the Christmas lead times for every tenant, disable the send-by-5 SLA
 * reminder platform-wide, or provision a live Stripe Price. Three of the four
 * returned 200 OK to an ops token before this was fixed.
 *
 * Reading the source rather than the compiled metadata, for the same reason the
 * cron-timezone guard does: what is worth pinning is that somebody wrote the
 * guard down next to the route. Reads are deliberately unrestricted — seeing
 * the config is an operator's job; changing it is not.
 *
 * The list is curated rather than "every controller", because most ops
 * mutations *are* ops work: advancing a fulfilment job, closing a support
 * ticket and resolving a return are all things an invited operator is hired to
 * do. What belongs here is the platform-settings surface — the controls that
 * act on every tenant at once. A new one has to be added by hand; the reason
 * next to each entry is what makes that a decision rather than an oversight.
 */
const CONTROLLERS = [
  // Platform config plus the money controls: wallet adjustments, comped plans,
  // Stripe price provisioning, dispatch windows, print defaults.
  join(__dirname, "admin.controller.ts"),
  // Marketing wallet campaigns: sets an amount credited to every new customer,
  // so it is the same kind of control as a hand-applied wallet adjustment.
  join(__dirname, "..", "wallet", "wallet-campaigns.controller.ts"),
  // The operator team itself — the other half of what ADR 0040 names.
  join(__dirname, "admin-team.controller.ts"),
];

/**
 * Mutating routes that are deliberately not super-admin-only, and why.
 *
 * One, and it has to be: `POST /admin/access` is how a first-time operator
 * becomes an operator at all, so requiring the role it grants would make the
 * whole surface unreachable.
 */
const EXEMPT = new Map([
  ["admin-team.controller.ts:37", "the sign-in bootstrap — see the route's own comment"],
]);
const MUTATING = /@(Post|Put|Patch|Delete)\(/;
const GUARD = "@UseGuards(PlatformAdminGuard, SuperAdminGuard)";

/**
 * Each mutating route in a file, with the decorators written around it.
 *
 * The whole contiguous run of decorators, not just the line above: the two
 * controllers put the guard on opposite sides of the route decorator, and a
 * scan that only looked upwards reported `admin-team.controller.ts` as having
 * five unguarded mutations when in fact every one of them is guarded. A guard
 * that is wrong about which code is unsafe gets ignored, so it reads the block.
 */
function mutationsIn(path: string): { line: string; block: string[]; where: string }[] {
  const lines = readFileSync(path, "utf8").split("\n");
  const isDecorator = (index: number): boolean => (lines[index] ?? "").trim().startsWith("@");

  return lines.flatMap((line, index) => {
    if (!MUTATING.test(line.trim())) return [];
    let first = index;
    while (first > 0 && isDecorator(first - 1)) first -= 1;
    let last = index;
    while (last < lines.length - 1 && isDecorator(last + 1)) last += 1;
    return [
      {
        line: line.trim(),
        block: lines.slice(first, last + 1).map((entry) => entry.trim()),
        where: `${path.split("/").pop()}:${index + 1}`,
      },
    ];
  });
}

describe("platform-settings controller mutations", () => {
  const mutations = CONTROLLERS.flatMap(mutationsIn);

  it("finds the mutating routes at all (the scan still works)", () => {
    expect(mutations.length).toBeGreaterThanOrEqual(18);
    // Every listed controller contributes — a file renamed out from under the
    // list would otherwise leave the total looking healthy.
    for (const controller of CONTROLLERS) {
      expect(mutationsIn(controller).length).toBeGreaterThan(0);
    }
  });

  it("reads the guard on either side of the route decorator", () => {
    // Proves the block scan can see both orders. Without this, the guard could
    // quietly go back to looking upwards only and call five guarded routes
    // unguarded — or, worse, stop noticing an unguarded one.
    const above = mutationsIn(CONTROLLERS[0] ?? "").every((entry) => entry.block.includes(GUARD));
    const below = mutationsIn(CONTROLLERS[2] ?? "").filter((entry) => !EXEMPT.has(entry.where));
    expect(above).toBe(true);
    expect(below.length).toBeGreaterThan(0);
    expect(below.every((entry) => entry.block.includes(GUARD))).toBe(true);
  });

  it("guards every one with SuperAdminGuard", () => {
    const unguarded = mutations
      .filter((entry) => !entry.block.includes(GUARD) && !EXEMPT.has(entry.where))
      .map((entry) => `${entry.where} ${entry.line}`);
    expect(unguarded).toEqual([]);
  });

  it("keeps the exemption pointing at a real route", () => {
    // An exemption that has drifted onto another line is worse than none: it
    // silently excuses whatever moved there.
    const found = mutations.filter((entry) => EXEMPT.has(entry.where));
    expect(found).toHaveLength(EXEMPT.size);
    expect(found[0]?.line).toContain('@Post("access")');
  });
});
