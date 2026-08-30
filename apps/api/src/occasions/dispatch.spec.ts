import {
  addWorkingDays,
  computeDispatchDate,
  DEFAULT_SEASONAL_DISPATCH_RULES,
  deliverByWindow,
  getSeasonalDispatchRules,
  isoDay,
  isWorkingDay,
  MAX_SCHEDULE_AHEAD_DAYS,
  POSTAGE_LEAD_DAYS,
  seasonalDispatchRuleFor,
  sendNowDispatchDate,
  startOfUtcDay,
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

  it("grants the rush lead to a card *posted* in the window, not one merely dated in it", () => {
    // New Year's Day 2027. Base lead alone posts it on Wed 23 Dec 2026 — the
    // busiest posting week of the year — and matching the rule on the occasion
    // date finds January, so no extra lead was granted at all. The rush is a
    // property of the transit window, not of the occasion's own date.
    const newYear = computeDispatchDate(utc(2027, 0, 4), 5);
    expect(newYear).toEqual(utc(2026, 11, 18));
  });

  it("withholds it from a card posted clear of the window", () => {
    // An occasion on 1 Dec posts on 24 Nov with base lead — a week before the
    // rush starts. It used to be granted the extra 3 days for being "in
    // December", posting it on 19 Nov, nearly a fortnight early.
    expect(computeDispatchDate(utc(2026, 11, 1), 5)).toEqual(utc(2026, 10, 24));
  });

  it("never posts later than the send-by-5 SLA, whichever way the rule falls", () => {
    // The seasonal rule only ever *adds* to the base lead, so no card loses the
    // send-by-5 guarantee because a window did or didn't match. Both of the
    // dates above are still at least 5 working days before their occasion.
    for (const [occasion, dispatch] of [
      [utc(2027, 0, 4), utc(2026, 11, 18)],
      [utc(2026, 11, 1), utc(2026, 10, 24)],
    ] as const) {
      expect(workingDaysUntil(occasion, dispatch)).toBeGreaterThanOrEqual(5);
    }
  });

  it("honours an injected custom rule set", () => {
    const rules: SeasonalDispatchRule[] = [
      {
        label: "Custom",
        from: { month: 3, day: 1 },
        to: { month: 3, day: 31 },
        extraLeadDays: 2,
        suggestFirstClass: false,
      },
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

  it("follows the same posting-date rule as the lead calculation", () => {
    // The nudge and the extra lead must agree, or the platform tells the
    // customer Royal Mail is slow while scheduling as though it is not. A card
    // for 4 Jan posts on 23 Dec: nudge it. A card for 1 Dec posts on 24 Nov:
    // don't.
    expect(suggestFirstClass(utc(2027, 0, 4)).suggested).toBe(true);
    expect(suggestFirstClass(utc(2026, 11, 1)).suggested).toBe(false);
  });

  it("does not suggest outside a busy window", () => {
    expect(suggestFirstClass(utc(2026, 6, 15)).suggested).toBe(false);
  });
});

describe("send-by-5 lead policy (ADR 0115)", () => {
  it("posts every class at least 5 working days before the delivery date", () => {
    // Both classes share the send-by-5 SLA: no card posts fewer than 5 working
    // days before its occasion, regardless of postage class.
    expect(POSTAGE_LEAD_DAYS.first_class).toBe(5);
    expect(POSTAGE_LEAD_DAYS.second_class).toBe(5);

    // Occasion Wed 15 Jul 2026 → both classes post Wed 8 Jul (5 working days back).
    const firstClass = computeDispatchDate(utc(2026, 6, 15), POSTAGE_LEAD_DAYS.first_class);
    const secondClass = computeDispatchDate(utc(2026, 6, 15), POSTAGE_LEAD_DAYS.second_class);
    expect(firstClass).toEqual(utc(2026, 6, 8));
    expect(secondClass).toEqual(utc(2026, 6, 8));
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
      {
        label: "Spring rush",
        from: { month: 3, day: 1 },
        to: { month: 3, day: 31 },
        extraLeadDays: 2,
        suggestFirstClass: true,
      },
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
      {
        label: "Explicit",
        from: { month: 6, day: 1 },
        to: { month: 6, day: 30 },
        extraLeadDays: 1,
        suggestFirstClass: false,
      },
    ];
    expect(seasonalDispatchRuleFor(utc(2026, 5, 15), rules)?.label).toBe("Explicit");
  });
});

describe("deliverByWindow (scheduled sends)", () => {
  beforeEach(() => setSeasonalDispatchRules([]));
  afterEach(() => setSeasonalDispatchRules(DEFAULT_SEASONAL_DISPATCH_RULES));

  it("earliest arrive-by inverts computeDispatchDate: posting it today lands today", () => {
    // Fri 7 Aug 2026: 5 working days forward is Fri 14 Aug.
    const from = utc(2026, 7, 7);
    const { earliest } = deliverByWindow("second_class", from);
    expect(isoDay(earliest)).toBe("2026-08-14");
    // And computing the post-by date back from that earliest is today.
    expect(isoDay(computeDispatchDate(earliest, POSTAGE_LEAD_DAYS.second_class))).toBe(
      "2026-08-07",
    );
  });

  it("offers an earliest arrive-by the API will actually accept, on any day", () => {
    // The invariant above held only on a working day before the cut-off. On a
    // weekend or a bank holiday, counting forward skipped those days while
    // counting back went through them, so the earliest arrive-by we offered had
    // a post-by date already in the past — which resolveSendSchedule rejects,
    // naming that very date as the soonest available. A sender scheduling at a
    // weekend met a dead end on the picker's own default value.
    const cases: [string, Date][] = [
      ["Saturday", utc(2026, 7, 29)],
      ["Sunday", utc(2026, 7, 30)],
      ["August bank holiday Monday", utc(2026, 7, 31)],
      ["ordinary Tuesday", utc(2026, 8, 1)],
    ];
    // Labelled so a failure names the day that broke rather than a bare date.
    const offered = cases.map(([label, from]) => {
      const { earliest } = deliverByWindow("second_class", from);
      const postsOn = computeDispatchDate(earliest, POSTAGE_LEAD_DAYS.second_class);
      const inThePast = postsOn.getTime() < startOfUtcDay(from).getTime();
      return `${label}: posts ${isoDay(postsOn)}${inThePast ? " — IN THE PAST" : ""}`;
    });
    expect(offered).toEqual([
      "Saturday: posts 2026-09-01",
      "Sunday: posts 2026-09-01",
      "August bank holiday Monday: posts 2026-09-01",
      "ordinary Tuesday: posts 2026-09-01",
    ]);
  });

  it("latest is the horizon out from today", () => {
    const from = utc(2026, 7, 7);
    const { latest } = deliverByWindow("second_class", from);
    const expected = new Date(from.getTime() + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000);
    expect(isoDay(latest)).toBe(isoDay(expected));
  });

  it("skips weekends when computing the post-by date from an arrive-by date", () => {
    // Arrive-by Fri 28 Aug 2026 → 5 working days back is Fri 21 Aug (skips 22/23).
    expect(isoDay(computeDispatchDate(utc(2026, 7, 28), POSTAGE_LEAD_DAYS.second_class))).toBe(
      "2026-08-21",
    );
  });
});

describe("sendNowDispatchDate", () => {
  it("posts today when ordered on a working day before the cut-off", () => {
    // Mon 12 Jan 2026, 10:00 GMT — before the 15:00 cut-off.
    expect(isoDay(sendNowDispatchDate(new Date("2026-01-12T10:00:00Z"), 15))).toBe("2026-01-12");
  });

  it("rolls to the next working day when ordered at/after the cut-off", () => {
    // Mon 12 Jan 2026, 16:00 GMT — after the cut-off → Tue 13 Jan.
    expect(isoDay(sendNowDispatchDate(new Date("2026-01-12T16:00:00Z"), 15))).toBe("2026-01-13");
  });

  it("judges the cut-off in UK local time, not UTC (BST)", () => {
    // 12 Aug 2026 (BST, UTC+1). 14:30 UTC is 15:30 London — past the 15:00
    // cut-off — so it must roll to the next working day (Thu 13 Aug). A naive UTC
    // comparison (14:30 < 15) would wrongly keep it today.
    expect(isoDay(sendNowDispatchDate(new Date("2026-08-12T14:30:00Z"), 15))).toBe("2026-08-13");
    // 13:30 UTC is 14:30 London — still before the cut-off → posts today.
    expect(isoDay(sendNowDispatchDate(new Date("2026-08-12T13:30:00Z"), 15))).toBe("2026-08-12");
  });

  it("rolls a weekend order to the next working day regardless of the hour", () => {
    // Sat 10 Jan 2026, 09:00 — nothing ships at the weekend → Mon 12 Jan.
    expect(isoDay(sendNowDispatchDate(new Date("2026-01-10T09:00:00Z"), 15))).toBe("2026-01-12");
  });
});
