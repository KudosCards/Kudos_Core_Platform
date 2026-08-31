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

/**
 * London top-of-hour instants for one calendar day, as the hours they land on.
 *
 * On the last Sunday in March, 01:00 doesn't happen; on the last Sunday in
 * October it happens twice. Everywhere else there are 24, one each.
 */
function londonTopOfHours(dayStartUtc: number): number[] {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PLATFORM_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const read = (at: Date) => {
    const f = parts.formatToParts(at);
    const get = (type: string) => f.find((part) => part.type === type)!.value;
    return {
      day: `${get("year")}-${get("month")}-${get("day")}`,
      hour: Number(get("hour")),
      minute: get("minute"),
    };
  };
  const target = read(new Date(dayStartUtc + 12 * 3_600_000)).day;
  const hours: number[] = [];
  // A 25-hour day needs a wider sweep than 24 steps, and the neighbours are
  // filtered out by the day check.
  for (let step = -2; step <= 26; step += 1) {
    const at = new Date(dayStartUtc + step * 3_600_000);
    const p = read(at);
    if (p.day === target && p.minute === "00") hours.push(p.hour);
  }
  return hours;
}

/** The London day-of-week (0 = Sunday) for a UTC instant. */
function londonWeekday(at: number): number {
  const name = new Intl.DateTimeFormat("en-GB", {
    timeZone: PLATFORM_TIME_ZONE,
    weekday: "short",
  }).format(new Date(at));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** The days-of-week a 5-field cron expression selects, as 0-6 (0 = Sunday). */
function scheduledWeekdays(expression: string): number[] {
  const field = expression.trim().split(/\s+/)[4] ?? "*";
  if (field === "*") return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const [from, to] = part.split("-").map((n) => Number(n) % 7);
    for (let d = from!; d !== ((to ?? from)! + 1) % 7; d = (d + 1) % 7) days.add(d);
    days.add((to ?? from)! % 7);
  }
  return [...days].sort();
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

  /**
   * A job that fires hourly and then gates on a configured hour has its real
   * schedule set at runtime, so every hour an operator can choose has to be
   * reachable on every day the cron runs. Two days a year don't offer all 24:
   * the last Sunday in March is missing 01:00 and the last Sunday in October
   * has it twice. Both are Sundays, which is why a Mon-Fri job is safe — and
   * why widening one to include the weekend would quietly cost a 01:00 digest
   * its day in spring, and give it two in autumn.
   *
   * The review raised this against the dispatch reminder (finding 34). It does
   * not bite there, because that cron is `0 * * * 1-5`. This is what keeps that
   * true. See ADR 0211.
   */
  it("only schedules hourly-gated jobs on days that offer every hour", () => {
    // Hourly *and* gated: the job fires every hour and then decides whether
    // this is its hour. A plain hourly interval (delivery-poll) doesn't care
    // which hour it is, so a short or doubled day costs it nothing.
    const hourly = jobs
      .filter((job) => /@Cron\("\S+ \* /.test(job.call))
      .filter((job) => readFileSync(join(SRC, job.file), "utf8").includes("londonHour("));
    // Vacuous if the pattern stops matching the dispatch reminder.
    expect(hourly.map((j) => j.file)).toEqual(["fulfillment/dispatch-reminder.service.ts"]);

    const problems: string[] = [];
    for (const job of hourly) {
      const expression = /@Cron\("([^"]+)"/.exec(job.call)![1]!;
      const days = scheduledWeekdays(expression);
      // Ten years of transitions is far past any horizon worth planning for,
      // and both directions of the change fall inside the scanned weeks.
      for (let year = 2026; year <= 2036; year += 1) {
        for (const month of [2, 9]) {
          for (let date = 22; date <= 31; date += 1) {
            const dayStart = Date.UTC(year, month, date);
            if (new Date(dayStart).getUTCMonth() !== month) continue;
            if (!days.includes(londonWeekday(dayStart + 12 * 3_600_000))) continue;
            const hours = londonTopOfHours(dayStart);
            const missing = [...Array(24).keys()].filter((h) => !hours.includes(h));
            const doubled = [...new Set(hours)].filter(
              (h) => hours.filter((x) => x === h).length > 1,
            );
            if (missing.length > 0 || doubled.length > 0) {
              problems.push(
                `${job.file} (${expression}) on ${year}-${month + 1}-${date}: ` +
                  `missing ${JSON.stringify(missing)}, doubled ${JSON.stringify(doubled)}`,
              );
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("can tell a day that is short an hour from an ordinary one", () => {
    // Proves the scan above is capable of failing. The clocks go forward on
    // Sunday 29 March 2026 and back on Sunday 25 October 2026.
    expect(londonTopOfHours(Date.UTC(2026, 2, 29))).not.toContain(1);
    expect(londonTopOfHours(Date.UTC(2026, 2, 29))).toHaveLength(23);
    expect(londonTopOfHours(Date.UTC(2026, 9, 25))).toHaveLength(25);
    expect(londonTopOfHours(Date.UTC(2026, 5, 15))).toHaveLength(24);
    // …and that both of them are Sundays, which is the reason a Mon-Fri job
    // never meets one.
    expect(londonWeekday(Date.UTC(2026, 2, 29, 12))).toBe(0);
    expect(londonWeekday(Date.UTC(2026, 9, 25, 12))).toBe(0);
    // The weekday parser the scan leans on.
    expect(scheduledWeekdays("0 * * * 1-5")).toEqual([1, 2, 3, 4, 5]);
    expect(scheduledWeekdays("0 * * * *")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(scheduledWeekdays("0 6 * * 1")).toEqual([1]);
  });

  it("leaves interval jobs unpinned, and only the ones named here", () => {
    for (const file of INTERVAL_JOBS) {
      const job = jobs.find((j) => j.file === file);
      expect(job).toBeDefined();
      expect(job!.call).not.toContain("timeZone");
    }
  });
});
