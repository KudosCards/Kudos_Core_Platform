import { ORDER_SOON_DAYS, orderUrgency, orderUrgencyLabel } from "./order-urgency";

const TODAY = "2026-09-26";

describe("orderUrgency", () => {
  it("counts a posting date that has gone", () => {
    expect(orderUrgency("2026-09-24", TODAY)).toEqual({ level: "passed", days: 2 });
  });

  // The whole point of the screen: a card due today is not already lost, and
  // saying so would send an operator looking for a refund instead of a button.
  it("treats today as still actionable, not missed", () => {
    expect(orderUrgency("2026-09-26", TODAY)).toEqual({ level: "soon", days: 0 });
  });

  it("marks anything inside the window as soon, and the day after as later", () => {
    expect(orderUrgency("2026-09-29", TODAY)).toEqual({ level: "soon", days: ORDER_SOON_DAYS });
    expect(orderUrgency("2026-09-30", TODAY)).toEqual({ level: "later", days: 4 });
  });

  // The API serialises a date column as a full ISO timestamp.
  it("reads a timestamp as its calendar day", () => {
    expect(orderUrgency("2026-09-28T00:00:00.000Z", TODAY)).toEqual({ level: "soon", days: 2 });
    expect(orderUrgency(new Date("2026-09-28T00:00:00.000Z"), TODAY)).toEqual({
      level: "soon",
      days: 2,
    });
  });

  // A timestamp late in the day must not read as the day before. Subtracting
  // Date.now() from midnight is what would do that.
  it("does not let the time of day shift the answer", () => {
    expect(orderUrgency("2026-09-26T23:59:59.000Z", TODAY)).toEqual({ level: "soon", days: 0 });
  });

  it("says nothing when there is nothing to judge", () => {
    expect(orderUrgency(null, TODAY)).toBeNull();
    expect(orderUrgency(undefined, TODAY)).toBeNull();
    expect(orderUrgency("not a date", TODAY)).toBeNull();
    expect(orderUrgency("2026-09-28", "not a date")).toBeNull();
  });

  it("spans a month boundary", () => {
    expect(orderUrgency("2026-10-01", "2026-09-30")).toEqual({ level: "soon", days: 1 });
    expect(orderUrgency("2026-09-30", "2026-10-01")).toEqual({ level: "passed", days: 1 });
  });
});

describe("orderUrgencyLabel", () => {
  it("names the deadline rather than printing a date to work out", () => {
    expect(orderUrgencyLabel({ level: "soon", days: 0 })).toBe("Must post today");
    expect(orderUrgencyLabel({ level: "soon", days: 1 })).toBe("Must post tomorrow");
    expect(orderUrgencyLabel({ level: "soon", days: 3 })).toBe("Must post in 3 days");
    expect(orderUrgencyLabel({ level: "later", days: 9 })).toBe("Must post in 9 days");
  });

  it("does not pluralise a single day", () => {
    expect(orderUrgencyLabel({ level: "passed", days: 1 })).toBe("Should have posted yesterday");
    expect(orderUrgencyLabel({ level: "passed", days: 4 })).toBe("Should have posted 4 days ago");
  });
});
