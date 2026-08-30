import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every mutating route on the admin controller is super-admin only.
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
 */
const CONTROLLER = join(__dirname, "admin.controller.ts");
const MUTATING = /@(Post|Put|Patch|Delete)\(/;
const GUARD = "@UseGuards(PlatformAdminGuard, SuperAdminGuard)";

describe("admin controller mutations", () => {
  const lines = readFileSync(CONTROLLER, "utf8").split("\n");

  /** Each mutating route decorator, with the line above it. */
  const mutations = lines
    .map((line, index) => ({ line: line.trim(), previous: (lines[index - 1] ?? "").trim(), index }))
    .filter((entry) => MUTATING.test(entry.line));

  it("finds the mutating routes at all (the scan still works)", () => {
    expect(mutations.length).toBeGreaterThanOrEqual(10);
  });

  it("guards every one with SuperAdminGuard", () => {
    const unguarded = mutations
      .filter((entry) => entry.previous !== GUARD)
      .map((entry) => `${CONTROLLER.split("/").pop()}:${entry.index + 1} ${entry.line}`);
    expect(unguarded).toEqual([]);
  });
});
