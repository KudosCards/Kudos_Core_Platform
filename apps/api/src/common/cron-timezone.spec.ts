import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PLATFORM_TIME_ZONE } from "./scheduling";

/**
 * Every scheduled job that means a time of day says which clock it means.
 *
 * Two of twelve jobs pinned a timezone and ten did not, so ten ran on the
 * container's UTC while their own comments talked about "6am" and "03:30". Half
 * the year those are different hours, and the difference arrives unannounced on
 * the last Sunday in March.
 *
 * Reading the source rather than the decorators because a decorator's options
 * are not introspectable once compiled, and because the thing worth guarding is
 * that somebody wrote it down.
 */

const SRC = join(__dirname, "..");

/**
 * Jobs whose schedule is an interval rather than a time of day. An interval is
 * the same length in every timezone, so pinning one would state a decision that
 * isn't being made. Listed explicitly: an exemption should be a choice, not the
 * default for anything that happens not to match a pattern.
 */
const INTERVAL_JOBS = new Set([
  "shipping/click-and-drop.service.ts",
  "fulfillment/delivery-poll.service.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

/** Every `@Cron(...)` call in the API, with the file it came from. */
function cronDecorators(): { file: string; call: string }[] {
  const found: { file: string; call: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/@Cron\(([^\n]*)\)/g)) {
      found.push({ file: file.slice(SRC.length + 1), call: match[0] });
    }
  }
  return found;
}

describe("scheduled jobs", () => {
  const jobs = cronDecorators();

  it("finds the schedule (a sanity check on the scan itself)", () => {
    // If this drops to zero the rest of the file passes vacuously.
    expect(jobs.length).toBeGreaterThanOrEqual(10);
  });

  it("pins every dated job to the platform clock", () => {
    const unpinned = jobs
      .filter((job) => !INTERVAL_JOBS.has(job.file))
      .filter((job) => !job.call.includes("PLATFORM_TIME_ZONE"));
    expect(unpinned.map((j) => `${j.file}  ${j.call}`)).toEqual([]);
  });

  it("names the clock once, rather than repeating a string literal", () => {
    // A second literal is how the two drift apart again.
    const literal = jobs.filter((job) => job.call.includes('"Europe/London"'));
    expect(literal.map((j) => j.file)).toEqual([]);
    expect(PLATFORM_TIME_ZONE).toBe("Europe/London");
  });

  it("leaves interval jobs unpinned, and only the ones named here", () => {
    for (const file of INTERVAL_JOBS) {
      const job = jobs.find((j) => j.file === file);
      expect(job).toBeDefined();
      expect(job!.call).not.toContain("timeZone");
    }
  });
});
