import { parseRecipientRow, parseUkDate } from "./csv-row.util";

describe("parseUkDate", () => {
  it("parses a valid dd/mm/yyyy date", () => {
    const date = parseUkDate("29/05/2011");
    expect(date.toISOString()).toBe("2011-05-29T00:00:00.000Z");
  });

  it("rejects a non dd/mm/yyyy format", () => {
    expect(() => parseUkDate("2011-05-29")).toThrow(/dd\/mm\/yyyy/);
  });

  it("rejects a calendar-invalid date (e.g. 31st of a 30-day month)", () => {
    expect(() => parseUkDate("31/04/2011")).toThrow(/not a real calendar date/);
  });

  it("rejects month/day values out of range", () => {
    expect(() => parseUkDate("29/13/2011")).toThrow(/not a real calendar date/);
  });
});

describe("parseRecipientRow", () => {
  const baseRow = { firstName: "Archie", lastName: "Winn" };

  it("parses a minimal valid row", () => {
    const result = parseRecipientRow(baseRow);
    expect(result).toEqual({
      firstName: "Archie",
      lastName: "Winn",
      dateOfBirth: null,
      addressLine1: null,
      addressLine2: null,
      addressCity: null,
      addressPostcode: null,
      email: null,
    });
  });

  it("parses a full postal address", () => {
    const result = parseRecipientRow({
      ...baseRow,
      addressLine1: "12 King Street",
      addressLine2: "Flat 2",
      addressCity: "London",
      postcode: "SW1A 1AA",
    });
    expect(result.addressLine1).toBe("12 King Street");
    expect(result.addressLine2).toBe("Flat 2");
    expect(result.addressCity).toBe("London");
    expect(result.addressPostcode).toBe("SW1A 1AA");
  });

  it("trims whitespace from all fields", () => {
    const result = parseRecipientRow({
      firstName: "  Archie  ",
      lastName: "  Winn ",
      postcode: " SW1A 1AA ",
      email: " archie@example.com ",
    });
    expect(result.firstName).toBe("Archie");
    expect(result.lastName).toBe("Winn");
    expect(result.addressPostcode).toBe("SW1A 1AA");
    expect(result.email).toBe("archie@example.com");
  });

  it("rejects a missing firstName", () => {
    expect(() => parseRecipientRow({ ...baseRow, firstName: "" })).toThrow(/firstName/);
  });

  it("rejects a missing lastName", () => {
    expect(() => parseRecipientRow({ ...baseRow, lastName: "" })).toThrow(/lastName/);
  });

  it("rejects an invalid UK postcode", () => {
    expect(() => parseRecipientRow({ ...baseRow, postcode: "NOTAPOSTCODE" })).toThrow(
      /valid UK postcode/,
    );
  });

  it("rejects an invalid email", () => {
    expect(() => parseRecipientRow({ ...baseRow, email: "not-an-email" })).toThrow(/valid email/);
  });

  it("parses a fully populated row", () => {
    const result = parseRecipientRow({
      firstName: "Archie",
      lastName: "Winn",
      dateOfBirth: "29/05/2011",
      postcode: "SW1A 1AA",
      email: "archie@example.com",
    });
    expect(result.dateOfBirth?.toISOString()).toBe("2011-05-29T00:00:00.000Z");
    expect(result.addressPostcode).toBe("SW1A 1AA");
    expect(result.email).toBe("archie@example.com");
  });
});
