import { nextBirthdayOccurrence } from "./next-birthday.util";

const utc = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m, d));

describe("nextBirthdayOccurrence", () => {
  it("returns this year's date when the birthday hasn't happened yet this year", () => {
    const dob = utc(2010, 6, 20); // 20 Jul
    const from = utc(2026, 6, 1); // 1 Jul 2026
    expect(nextBirthdayOccurrence(dob, from)).toEqual(utc(2026, 6, 20));
  });

  it("returns today when the birthday is today", () => {
    const dob = utc(2010, 6, 20);
    const from = utc(2026, 6, 20);
    expect(nextBirthdayOccurrence(dob, from)).toEqual(utc(2026, 6, 20));
  });

  it("rolls over to next year when this year's birthday has already passed", () => {
    const dob = utc(2010, 0, 15); // 15 Jan
    const from = utc(2026, 6, 1); // 1 Jul 2026
    expect(nextBirthdayOccurrence(dob, from)).toEqual(utc(2027, 0, 15));
  });

  it("handles the December-to-January year rollover", () => {
    const dob = utc(2010, 11, 25); // 25 Dec
    const from = utc(2026, 11, 30); // 30 Dec 2026
    expect(nextBirthdayOccurrence(dob, from)).toEqual(utc(2027, 11, 25));
  });

  it("maps a 29 Feb birthday to 28 Feb in a non-leap year", () => {
    const dob = utc(2000, 1, 29);
    const from = utc(2027, 0, 1); // 2027 is not a leap year
    expect(nextBirthdayOccurrence(dob, from)).toEqual(utc(2027, 1, 28));
  });

  it("maps a 29 Feb birthday to 29 Feb in a leap year", () => {
    const dob = utc(2000, 1, 29);
    const from = utc(2028, 0, 1); // 2028 is a leap year
    expect(nextBirthdayOccurrence(dob, from)).toEqual(utc(2028, 1, 29));
  });

  it("ignores the time-of-day component of dateOfBirth", () => {
    const dob = new Date(Date.UTC(2010, 6, 20, 23, 59, 59));
    const from = utc(2026, 6, 1);
    expect(nextBirthdayOccurrence(dob, from)).toEqual(utc(2026, 6, 20));
  });
});
