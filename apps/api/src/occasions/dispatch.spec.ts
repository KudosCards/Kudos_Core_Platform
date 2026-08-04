import {
  addWorkingDays,
  computeDispatchDate,
  DEFAULT_SEASONAL_DISPATCH_RULES,
  getSeasonalDispatchRules,
  isWorkingDay,
  seasonalDispatchRuleFor,
  setSeasonalDispatchRules,
  suggestFirstClass,
  UK_BANK_HOLIDAYS,
  workingDaysUntil,
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

describe("addWorkingDays", () => {
  it("steps forward over a weekend", () => {
    // Thu 9 Jul 2026 + 3 working days: Fri 10, (skip Sat/Sun), Mon 13, Tue 14.
    expect(addWorkingDays(utc(2026, 6, 9), 3)).toEqual(utc(2026, 6, 14));
  });

  it("skips a bank holiday when stepping forward", () => {
    // Fri 22 May 2026 + 1 working day: (skip Sat 23, Sun 24, Mon 25 holiday) → Tue 26.
    expect(addWorkingDays(utc(2026, 4, 22), 1)).toEqual(utc(2026, 4, 26));
  });

  it("returns the same day for zero and steps backward for negatives", () => {
    expect(addWorkingDays(utc(2026, 6, 15), 0)).toEqual(utc(2026, 6, 15));
    // Mirrors computeDispatchDate's backward count: Wed 15 Jul, 5 back → 8 Jul.
    expect(addWorkingDays(utc(2026, 6, 15), -5)).toEqual(utc(2026, 6, 8));
  });
});

describe("workingDaysUntil", () => {
  it("is zero for the same day, signed by direction", () => {
    expect(workingDaysUntil(utc(2026, 6, 15), utc(2026, 6, 15))).toBe(0);
    // From Wed 8 Jul to Wed 15 Jul = 5 working days ahead (skips one weekend).
    expect(workingDaysUntil(utc(2026, 6, 15), utc(2026, 6, 8))).toBe(5);
    // The reverse is negative (overdue).
    expect(workingDaysUntil(utc(2026, 6, 8), utc(2026, 6, 15))).toBe(-5);
  });

  it("does not count a bank holiday between the two dates", () => {
    // Fri 22 May to Tue 26 May crosses Sat/Sun + Mon 25 (holiday) = 1 working day.
    expect(workingDaysUntil(utc(2026, 4, 26), utc(2026, 4, 22))).toBe(1);
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

describe("runtime-configurable seasonal rules", () => {
  // The active set is a process-wide global; always restore the default so a
  // config test can't bleed into the others.
  afterEach(() => setSeasonalDispatchRules(DEFAULT_SEASONAL_DISPATCH_RULES));

  it("makes the default engine calls honour a newly set rule set", () => {
    // Out of the box, mid-March is not in any window.
    expect(suggestFirstClass(utc(2026, 2, 15)).suggested).toBe(false);

    setSeasonalDispatchRules([
      { label: "Spring rush", from: { month: 3, day: 1 }, to: { month: 3, day: 31 }, extraLeadDays: 2, suggestFirstClass: true },
    ]);

    expect(getSeasonalDispatchRules()).toHaveLength(1);
    expect(suggestFirstClass(utc(2026, 2, 15)).suggested).toBe(true);
    expect(seasonalDispatchRuleFor(utc(2026, 2, 15))?.label).toBe("Spring rush");
    // And the Christmas default no longer applies until reset.
    expect(seasonalDispatchRuleFor(utc(2026, 11, 20))).toBeNull();
  });

  it("resets cleanly to the bundled Christmas default", () => {
    setSeasonalDispatchRules([]);
    expect(seasonalDispatchRuleFor(utc(2026, 11, 20))).toBeNull();

    setSeasonalDispatchRules(DEFAULT_SEASONAL_DISPATCH_RULES);
    expect(seasonalDispatchRuleFor(utc(2026, 11, 20))?.label).toBe("Christmas post rush");
  });

  it("still honours an explicit per-call rule set over the active one", () => {
    setSeasonalDispatchRules([]);
    const rules: SeasonalDispatchRule[] = [
      { label: "Explicit", from: { month: 6, day: 1 }, to: { month: 6, day: 30 }, extraLeadDays: 1, suggestFirstClass: false },
    ];
    expect(seasonalDispatchRuleFor(utc(2026, 5, 15), rules)?.label).toBe("Explicit");
  });
});
