import { buildScheduledKeyDateOccasion } from "./key-date-occasion.util";

describe("buildScheduledKeyDateOccasion", () => {
  const today = new Date(Date.UTC(2026, 0, 1)); // 1 Jan 2026

  it("schedules the next annual occurrence with the right type, source, status and title", () => {
    const occasion = buildScheduledKeyDateOccasion(
      {
        accountId: "acc",
        recipientId: "rec",
        type: "renewal",
        date: new Date(Date.UTC(2019, 2, 15)), // 15 Mar (year ignored)
        label: "Membership renewal",
      },
      today,
    );
    expect(occasion.type).toBe("renewal");
    expect(occasion.source).toBe("recurring_per_recipient");
    expect(occasion.status).toBe("scheduled");
    expect(occasion.title).toBe("Membership renewal");
    // Next 15 March on/after 1 Jan 2026 → 15 Mar 2026.
    expect((occasion.occasionDate as Date).toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("omits the title when no label is given", () => {
    const occasion = buildScheduledKeyDateOccasion(
      { accountId: "acc", recipientId: "rec", type: "anniversary", date: new Date(Date.UTC(2019, 5, 1)) },
      today,
    );
    expect(occasion.title).toBeUndefined();
  });
});
