import { londonDay, londonDayStart, previousLondonDay } from "./london-day";

/**
 * The digest reports "yesterday" to a UK reader, so these pin the two days a
 * year the answer isn't simply "the previous UTC day" — and the ordinary days
 * either side of them, so a regression can't hide in the special cases.
 *
 * 2026 transitions: BST starts Sun 29 March (01:00 UTC), ends Sun 25 October
 * (01:00 UTC).
 */
describe("London calendar days", () => {
  describe("londonDayStart", () => {
    it("is UTC midnight in winter", () => {
      expect(londonDayStart("2026-01-15").toISOString()).toBe("2026-01-15T00:00:00.000Z");
    });

    it("is 23:00 the previous UTC day in summer", () => {
      expect(londonDayStart("2026-08-17").toISOString()).toBe("2026-08-16T23:00:00.000Z");
    });

    it("handles the day the clocks go forward", () => {
      // Clocks go forward at 01:00 GMT, so midnight that day is still GMT.
      expect(londonDayStart("2026-03-29").toISOString()).toBe("2026-03-29T00:00:00.000Z");
      expect(londonDayStart("2026-03-30").toISOString()).toBe("2026-03-29T23:00:00.000Z");
    });

    it("handles the day the clocks go back", () => {
      expect(londonDayStart("2026-10-25").toISOString()).toBe("2026-10-24T23:00:00.000Z");
      expect(londonDayStart("2026-10-26").toISOString()).toBe("2026-10-26T00:00:00.000Z");
    });
  });

  describe("londonDay", () => {
    it("reads 00:30 BST as the new London day, not the old UTC one", () => {
      // 23:30 UTC on the 17th is already 00:30 on the 18th in London — the exact
      // hour that would be filed under the wrong day by a UTC-day digest.
      expect(londonDay(new Date("2026-08-17T23:30:00Z"))).toBe("2026-08-18");
    });

    it("agrees with UTC in winter", () => {
      expect(londonDay(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-15");
    });
  });

  describe("previousLondonDay", () => {
    it("covers a whole 24-hour day in winter", () => {
      const window = previousLondonDay(new Date("2026-01-15T07:30:00Z"));
      expect(window.day).toBe("2026-01-14");
      expect(window.from.toISOString()).toBe("2026-01-14T00:00:00.000Z");
      expect(window.to.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    });

    it("shifts with BST in summer", () => {
      // 07:30 London on 18 Aug is 06:30 UTC.
      const window = previousLondonDay(new Date("2026-08-18T06:30:00Z"));
      expect(window.day).toBe("2026-08-17");
      expect(window.from.toISOString()).toBe("2026-08-16T23:00:00.000Z");
      expect(window.to.toISOString()).toBe("2026-08-17T23:00:00.000Z");
    });

    it("reports the clocks-back day as the 25 hours it actually was", () => {
      const window = previousLondonDay(new Date("2026-10-26T07:30:00Z"));
      expect(window.day).toBe("2026-10-25");
      const hours = (window.to.getTime() - window.from.getTime()) / 3_600_000;
      expect(hours).toBe(25);
    });

    it("reports the clocks-forward day as the 23 hours it actually was", () => {
      const window = previousLondonDay(new Date("2026-03-30T06:30:00Z"));
      expect(window.day).toBe("2026-03-29");
      const hours = (window.to.getTime() - window.from.getTime()) / 3_600_000;
      expect(hours).toBe(23);
    });

    it("leaves no gap or overlap between consecutive days", () => {
      const first = previousLondonDay(new Date("2026-10-25T07:30:00Z"));
      const second = previousLondonDay(new Date("2026-10-26T07:30:00Z"));
      expect(first.to.toISOString()).toBe(second.from.toISOString());
    });
  });
});
