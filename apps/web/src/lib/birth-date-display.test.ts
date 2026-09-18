import { BIRTHDAY_PLACEHOLDER_YEAR, formatBirthDate } from "@kudos/shared-types";

/**
 * A birthday imported from a source that never asked for a year carries a
 * placeholder one. Every screen that shows a date of birth goes through here,
 * so that the placeholder is never shown, exported, or mistaken for real.
 */
describe("formatBirthDate", () => {
  const known = new Date("1985-03-14T00:00:00Z");
  const placeholder = new Date(Date.UTC(BIRTHDAY_PLACEHOLDER_YEAR, 2, 14));

  it("shows the year when we actually know it", () => {
    expect(formatBirthDate(known, true)).toBe("14/03/1985");
    expect(formatBirthDate(known, true, "long")).toBe("14 March 1985");
  });

  it("leaves the year out rather than printing a placeholder", () => {
    expect(formatBirthDate(placeholder, false)).toBe("14/03");
    expect(formatBirthDate(placeholder, false, "long")).toBe("14 March");
    expect(formatBirthDate(placeholder, false)).not.toContain(String(BIRTHDAY_PLACEHOLDER_YEAR));
  });

  it("reads the date in UTC, so the day does not shift west of Greenwich", () => {
    // A @db.Date arrives as UTC midnight. Local-time getters read the day
    // before it in every timezone behind UTC — a card a day early, every year.
    expect(formatBirthDate("2000-01-01T00:00:00.000Z", false, "long")).toBe("1 January");
  });

  it("accepts the ISO string the API sends as well as a Date", () => {
    expect(formatBirthDate("1985-03-14T00:00:00.000Z", true)).toBe("14/03/1985");
  });

  it("returns nothing for a date that is not a date", () => {
    expect(formatBirthDate("not a date", true)).toBe("");
  });
});
