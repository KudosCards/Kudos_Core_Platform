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
];
const MUTATING = /@(Post|Put|Patch|Delete)\(/;
const GUARD = "@UseGuards(PlatformAdminGuard, SuperAdminGuard)";

/** Each mutating route decorator in a file, with the line above it. */
function mutationsIn(path: string): { line: string; previous: string; where: string }[] {
  const lines = readFileSync(path, "utf8").split("\n");
  return lines
    .map((line, index) => ({
      line: line.trim(),
      previous: (lines[index - 1] ?? "").trim(),
      where: `${path.split("/").pop()}:${index + 1}`,
    }))
    .filter((entry) => MUTATING.test(entry.line));
}

describe("platform-settings controller mutations", () => {
  const mutations = CONTROLLERS.flatMap(mutationsIn);

  it("finds the mutating routes at all (the scan still works)", () => {
    expect(mutations.length).toBeGreaterThanOrEqual(13);
    // Every listed controller contributes — a file renamed out from under the
    // list would otherwise leave the total looking healthy.
    for (const controller of CONTROLLERS) {
      expect(mutationsIn(controller).length).toBeGreaterThan(0);
    }
  });

  it("guards every one with SuperAdminGuard", () => {
    const unguarded = mutations
      .filter((entry) => entry.previous !== GUARD)
      .map((entry) => `${entry.where} ${entry.line}`);
    expect(unguarded).toEqual([]);
  });
});
