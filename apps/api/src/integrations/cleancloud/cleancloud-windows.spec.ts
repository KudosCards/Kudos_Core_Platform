import {
  CLEANCLOUD_MAX_WINDOWS,
  CLEANCLOUD_WINDOW_DAYS,
  cleanCloudDate,
  customerWindows,
} from "./cleancloud-windows";

const MS_PER_DAY = 86_400_000;
const NOW = new Date("2026-09-18T11:30:00Z");

describe("customerWindows", () => {
  it("starts at today and works backwards, newest window first", () => {
    const { windows } = customerWindows(NOW, 1);

    expect(cleanCloudDate(windows[0]!.to)).toBe("2026-09-18");
    expect(cleanCloudDate(windows[0]!.from)).toBe("2026-08-19");
    expect(windows[1]!.to.getTime()).toBeLessThan(windows[0]!.from.getTime());
  });

  it("never asks for more than CleanCloud's 31-day maximum", () => {
    const { windows } = customerWindows(NOW, 10);

    for (const window of windows) {
      const days = (window.to.getTime() - window.from.getTime()) / MS_PER_DAY + 1;
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(CLEANCLOUD_WINDOW_DAYS);
    }
  });

  it("leaves no gap and no overlap between consecutive windows", () => {
    const { windows } = customerWindows(NOW, 2);

    for (let i = 1; i < windows.length; i += 1) {
      // Each window ends exactly one day before the previous one begins: a gap
      // loses a day's sign-ups, an overlap pays for the same request twice.
      expect(windows[i]!.to.getTime()).toBe(windows[i - 1]!.from.getTime() - MS_PER_DAY);
    }
  });

  it("covers the whole horizon and stops, rather than running past it", () => {
    const { windows, coversFullHistory } = customerWindows(NOW, 10);
    const oldest = windows[windows.length - 1]!;

    expect(coversFullHistory).toBe(true);
    expect(cleanCloudDate(oldest.from)).toBe("2016-09-18");
    // A decade at 31 days a request is the number the design rests on.
    expect(windows.length).toBeLessThanOrEqual(CLEANCLOUD_MAX_WINDOWS);
    expect(windows.length).toBe(Math.ceil((365 * 10 + 3) / CLEANCLOUD_WINDOW_DAYS));
  });

  it("says so when the request cap stops it short of the horizon", () => {
    // Far more history than CLEANCLOUD_MAX_WINDOWS can cover: the plan is
    // partial, and must not claim otherwise.
    const { windows, coversFullHistory } = customerWindows(NOW, 100);

    expect(windows).toHaveLength(CLEANCLOUD_MAX_WINDOWS);
    expect(coversFullHistory).toBe(false);
  });
});

describe("cleanCloudDate", () => {
  it("formats as YYYY-MM-DD in UTC", () => {
    expect(cleanCloudDate(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });

  it("does not shift the day for a host west of Greenwich", () => {
    // 23:30 UTC is still the 18th; a local-time formatter in New York would
    // call this the 18th too, but 00:30 UTC on the 19th would come back as the
    // 18th and silently move the whole window.
    expect(cleanCloudDate(new Date("2026-09-19T00:30:00Z"))).toBe("2026-09-19");
  });
});
