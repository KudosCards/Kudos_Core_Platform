import {
  computeDispatchDate,
  isWorkingDay,
  seasonalDispatchRuleFor,
  suggestFirstClass,
  UK_BANK_HOLIDAYS,
  type SeasonalDispatchRule,
} from "@kudos/shared-types";

const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m, d));

describe("isWorkingDay", () => {
  it("is false on Saturday and Sunday, true on a weekday", () => {
    // 25 Jul 2026 is a Saturday, 26 Jul a Sunday, 27 Jul a Monday.
    expect(isWorkingDay(utc(2026, 6, 25))).toBe(false); // Saturday
    expect(isWorkingDay(utc(2026, 6, 26))).toBe(false); // Sunday
    expect(isWorkingDay(utc(2026, 6, 27))).toBe(true); // Monday
  });

  it("is false on a bank holiday weekday", () => {
    // 25 Dec 2026 (Christmas Day) is a Friday — a weekday, but a holiday.
    expect(utc(2026, 11, 25).getUTCDay()).toBe(5);
    expect(isWorkingDay(utc(2026, 11, 25))).toBe(false);
    expect(UK_BANK_HOLIDAYS.has("2026-12-25")).toBe(true);
  });
});

describe("computeDispatchDate — working days", () => {
  it("subtracts working days, skipping the weekend", () => {
    // Occasion Wed 15 Jul 2026, 5 working days back:
    // Tue 14, Mon 13, Fri 10, Thu 9, Wed 8 → 8 Jul 2026.
    expect(computeDispatchDate(utc(2026, 6, 15), 5)).toEqual(utc(2026, 6, 8));
  });

  it("skips a bank holiday inside the run", () => {
    // Occasion Thu 28 May 2026, 3 working days back. Mon 25 May is the Spring
    // bank holiday, 23/24 May the weekend. Wed 27, Tue 26, (skip Mon 25 holiday,
    // Sun 24, Sat 23), Fri 22 → 22 May 2026. (28 May is outside any seasonal
    // window, so only the postage lead applies.)
    expect(computeDispatchDate(utc(2026, 4, 28), 3)).toEqual(utc(2026, 4, 22));
  });

  it("always lands on a working day", () => {
    // Occasion Mon 6 Jul 2026, 1 working day back is Fri 3 Jul (not Sunday 5th).
    expect(computeDispatchDate(utc(2026, 6, 6), 1)).toEqual(utc(2026, 6, 3));
  });

  it("returns the occasion date itself when lead is zero", () => {
    expect(computeDispatchDate(utc(2026, 6, 15), 0)).toEqual(utc(2026, 6, 15));
  });
});

describe("seasonal override", () => {
  it("matches the seeded Christmas window", () => {
    expect(seasonalDispatchRuleFor(utc(2026, 11, 20))?.label).toBe("Christmas post rush");
    expect(seasonalDispatchRuleFor(utc(2026, 10, 20))).toBeNull(); // 20 Nov — outside
  });

  it("adds the window's extra lead days on top of the postage lead", () => {
    // Occasion 18 Dec 2026 (Friday), 5 working days + 3 seasonal = 8 working days.
    const plain = computeDispatchDate(utc(2026, 6, 15), 5); // 8 Jul, no season
    expect(plain).toEqual(utc(2026, 6, 8));
    const seasonal = computeDispatchDate(utc(2026, 11, 18), 5);
    // 8 working days before Fri 18 Dec 2026, skipping weekends only (no holidays
    // in this stretch): Thu 17, Wed 16, Tue 15, Mon 14, Fri 11, Thu 10, Wed 9,
    // Tue 8 → 8 Dec 2026.
    expect(seasonal).toEqual(utc(2026, 11, 8));
  });

  it("honours an injected custom rule set", () => {
    const rules: SeasonalDispatchRule[] = [
      { label: "Custom", from: { month: 3, day: 1 }, to: { month: 3, day: 31 }, extraLeadDays: 2, suggestFirstClass: false },
    ];
    expect(seasonalDispatchRuleFor(utc(2026, 2, 15), rules)?.label).toBe("Custom");
    expect(seasonalDispatchRuleFor(utc(2026, 11, 15), rules)).toBeNull();
  });
});

describe("suggestFirstClass", () => {
  it("suggests First Class inside the Christmas window", () => {
    const result = suggestFirstClass(utc(2026, 11, 12));
    expect(result.suggested).toBe(true);
    expect(result.reason).toContain("First Class");
  });

  it("does not suggest outside a busy window", () => {
    expect(suggestFirstClass(utc(2026, 6, 15)).suggested).toBe(false);
  });
});
