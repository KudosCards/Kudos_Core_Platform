import { parseFlexibleDate, parseRecipientRow, parseUkDate } from "./csv-row.util";

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

describe("parseFlexibleDate", () => {
  it("parses dd/mm/yyyy", () => {
    expect(parseFlexibleDate("29/05/2011")?.toISOString()).toBe("2011-05-29T00:00:00.000Z");
  });
  it("parses dd-mm-yyyy", () => {
    expect(parseFlexibleDate("29-05-2011")?.toISOString()).toBe("2011-05-29T00:00:00.000Z");
  });
  it("parses ISO yyyy-mm-dd", () => {
    expect(parseFlexibleDate("2011-05-29")?.toISOString()).toBe("2011-05-29T00:00:00.000Z");
  });
  it("returns null for an unrecognised format", () => {
    expect(parseFlexibleDate("May 29, 2011")).toBeNull();
    expect(parseFlexibleDate("29.05.2011")).toBeNull();
  });
  it("returns null for an impossible calendar date", () => {
    expect(parseFlexibleDate("31/04/2011")).toBeNull();
    expect(parseFlexibleDate("2011-02-30")).toBeNull();
  });
});

describe("parseRecipientRow", () => {
  const baseRow = { firstName: "Archie", lastName: "Winn" };

  it("parses a minimal valid row (no warnings)", () => {
    const { parsed, warnings } = parseRecipientRow(baseRow);
    expect(parsed).toEqual({
      firstName: "Archie",
      lastName: "Winn",
      dateOfBirth: null,
      addressLine1: null,
      addressLine2: null,
      addressCity: null,
      addressPostcode: null,
      email: null,
    });
    expect(warnings).toEqual([]);
  });

  it("parses a full postal address", () => {
    const { parsed } = parseRecipientRow({
      ...baseRow,
      addressLine1: "12 King Street",
      addressLine2: "Flat 2",
      addressCity: "London",
      postcode: "SW1A 1AA",
    });
    expect(parsed.addressLine1).toBe("12 King Street");
    expect(parsed.addressLine2).toBe("Flat 2");
    expect(parsed.addressCity).toBe("London");
    expect(parsed.addressPostcode).toBe("SW1A 1AA");
  });

  it("trims whitespace from all fields", () => {
    const { parsed } = parseRecipientRow({
      firstName: "  Archie  ",
      lastName: "  Winn ",
      postcode: " SW1A 1AA ",
      email: " archie@example.com ",
    });
    expect(parsed.firstName).toBe("Archie");
    expect(parsed.lastName).toBe("Winn");
    expect(parsed.addressPostcode).toBe("SW1A 1AA");
    expect(parsed.email).toBe("archie@example.com");
  });

  it("still rejects a missing firstName / lastName (the only required fields)", () => {
    expect(() => parseRecipientRow({ ...baseRow, firstName: "" })).toThrow(/firstName/);
    expect(() => parseRecipientRow({ ...baseRow, lastName: "" })).toThrow(/lastName/);
  });

  it("accepts a non-dd/mm/yyyy date of birth (ISO) without rejecting the row", () => {
    const { parsed, warnings } = parseRecipientRow({ ...baseRow, dateOfBirth: "2011-05-29" });
    expect(parsed.dateOfBirth?.toISOString()).toBe("2011-05-29T00:00:00.000Z");
    expect(warnings).toEqual([]);
  });

  it("imports (with a warning) rather than rejecting an unrecognised date of birth", () => {
    const { parsed, warnings } = parseRecipientRow({ ...baseRow, dateOfBirth: "May 29 2011" });
    expect(parsed.firstName).toBe("Archie");
    expect(parsed.dateOfBirth).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/date of birth/i);
  });

  it("imports (with a warning) rather than rejecting an invalid postcode", () => {
    const { parsed, warnings } = parseRecipientRow({ ...baseRow, postcode: "NOTAPOSTCODE" });
    expect(parsed.addressPostcode).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/postcode/i);
  });

  it("imports (with a warning) rather than rejecting an invalid email", () => {
    const { parsed, warnings } = parseRecipientRow({ ...baseRow, email: "not-an-email" });
    expect(parsed.email).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/email/i);
  });

  it("parses a fully populated valid row", () => {
    const { parsed, warnings } = parseRecipientRow({
      firstName: "Archie",
      lastName: "Winn",
      dateOfBirth: "29/05/2011",
      postcode: "SW1A 1AA",
      email: "archie@example.com",
    });
    expect(parsed.dateOfBirth?.toISOString()).toBe("2011-05-29T00:00:00.000Z");
    expect(parsed.addressPostcode).toBe("SW1A 1AA");
    expect(parsed.email).toBe("archie@example.com");
    expect(warnings).toEqual([]);
  });

  it("imports a contact without a date of birth nobody could be born on", () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const dd = String(future.getUTCDate()).padStart(2, "0");
    const mm = String(future.getUTCMonth() + 1).padStart(2, "0");

    const { parsed, warnings } = parseRecipientRow({
      ...baseRow,
      dateOfBirth: `${dd}/${mm}/${future.getUTCFullYear()}`,
    });
    // The row still imports — a whole file should not fail over one bad cell —
    // but not carrying a birthday the platform would schedule a card for.
    expect(parsed.dateOfBirth).toBeNull();
    expect(warnings.join(" ")).toMatch(/could be born on/i);
  });

  it("still accepts a real date of birth", () => {
    const { parsed, warnings } = parseRecipientRow({ ...baseRow, dateOfBirth: "23/10/1996" });
    expect(parsed.dateOfBirth?.toISOString()).toBe("1996-10-23T00:00:00.000Z");
    expect(warnings).toHaveLength(0);
  });
});
