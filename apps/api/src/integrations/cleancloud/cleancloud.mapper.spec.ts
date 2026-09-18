import { BIRTHDAY_PLACEHOLDER_YEAR, birthdayWithoutYear } from "@kudos/shared-types";
import { mapCleanCloudCustomer, splitCustomerName } from "./cleancloud.mapper";

const CUSTOMER = {
  customerID: "42",
  customerName: "Alice Archer",
  customerAddress: "12 Acacia Avenue, London, SW1A 1AA",
  customerEmail: "alice@example.com",
  birthdayDay: "14",
  birthdayMonth: "3",
};

describe("splitCustomerName", () => {
  it("splits on the last whitespace so the surname is the final token", () => {
    expect(splitCustomerName("Mary Anne Clarke")).toEqual({
      firstName: "Mary Anne",
      lastName: "Clarke",
    });
  });

  it("collapses stray whitespace first", () => {
    expect(splitCustomerName("  Alice   Archer  ")).toEqual({
      firstName: "Alice",
      lastName: "Archer",
    });
  });

  it.each(["Yusuf", "Cher", "", "   ", null, undefined])("refuses the mononym %p", (input) => {
    // Dropped, and counted as `unmappable` where the customer can see it. The
    // alternatives print "Dear Yusuf Yusuf" or a made-up surname on an
    // envelope — a contact we cannot address is better not sent than sent
    // wrong.
    expect(splitCustomerName(input)).toBeNull();
  });

  it("caps each name at the column limit", () => {
    const long = "x".repeat(300);
    const split = splitCustomerName(`${long} ${long}`);
    expect(split?.firstName).toHaveLength(120);
    expect(split?.lastName).toHaveLength(120);
  });
});

describe("mapCleanCloudCustomer", () => {
  it("maps a complete customer", () => {
    expect(mapCleanCloudCustomer(CUSTOMER)).toEqual({
      externalId: "42",
      firstName: "Alice",
      lastName: "Archer",
      email: "alice@example.com",
      dateOfBirth: new Date(Date.UTC(BIRTHDAY_PLACEHOLDER_YEAR, 2, 14)),
      birthYearKnown: false,
      addressLine1: "12 Acacia Avenue",
      addressLine2: null,
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
      addressCountry: null,
    });
  });

  it("accepts a numeric customer id", () => {
    expect(mapCleanCloudCustomer({ ...CUSTOMER, customerID: 42 })?.externalId).toBe("42");
  });

  it.each([null, undefined, "", "  "])("drops a customer with no id (%p)", (customerID) => {
    // The id is what the ingest dedupes on; without one, tonight's sync would
    // create the same person again.
    expect(mapCleanCloudCustomer({ ...CUSTOMER, customerID })).toBeNull();
  });

  it("drops a customer whose name cannot be split", () => {
    expect(mapCleanCloudCustomer({ ...CUSTOMER, customerName: "Yusuf" })).toBeNull();
  });

  it("marks the birth year as unknown, because CleanCloud never asks for one", () => {
    const contact = mapCleanCloudCustomer(CUSTOMER);
    expect(contact?.birthYearKnown).toBe(false);
    expect(contact?.dateOfBirth?.getUTCFullYear()).toBe(BIRTHDAY_PLACEHOLDER_YEAR);
  });

  it("keeps 29 February as 29 February", () => {
    // The placeholder year is a leap year precisely so this cannot roll into
    // 1 March and move somebody's card by a day.
    const contact = mapCleanCloudCustomer({ ...CUSTOMER, birthdayDay: 29, birthdayMonth: 2 });
    expect(contact?.dateOfBirth).toEqual(new Date(Date.UTC(BIRTHDAY_PLACEHOLDER_YEAR, 1, 29)));
  });

  it.each([
    [31, 2],
    [0, 5],
    [32, 1],
    [14, 13],
    [14, 0],
  ])("refuses the impossible date %i/%i", (birthdayDay, birthdayMonth) => {
    const contact = mapCleanCloudCustomer({ ...CUSTOMER, birthdayDay, birthdayMonth });
    expect(contact?.dateOfBirth).toBeNull();
  });

  it.each([
    ["", ""],
    [null, null],
    ["14", null],
    ["not a day", "3"],
  ])("imports a customer with no usable birthday (%p/%p)", (birthdayDay, birthdayMonth) => {
    const contact = mapCleanCloudCustomer({ ...CUSTOMER, birthdayDay, birthdayMonth });
    // Still worth having: the customer can fill the birthday in by hand, and
    // readinessFor is what tells them how many need it.
    expect(contact?.externalId).toBe("42");
    expect(contact?.dateOfBirth).toBeNull();
    // Nothing to qualify, so the flag is left at its default rather than
    // marking a birthday that does not exist as yearless.
    expect(contact?.birthYearKnown).toBeUndefined();
  });

  it.each(["0x1f", "1e1", " 14 "])("reads %p as digits or not at all", (birthdayDay) => {
    // `Number()` is far more willing than a date field should be: it reads
    // "0x1f" as 31 and "1e1" as 10, either of which is a real-looking day that
    // nobody typed. Only a run of digits counts.
    const contact = mapCleanCloudCustomer({ ...CUSTOMER, birthdayDay });
    const expected = birthdayDay.trim() === "14" ? 14 : null;
    expect(contact?.dateOfBirth?.getUTCDate() ?? null).toBe(expected);
  });

  it("drops an email that is not an email", () => {
    // Stored, it would not fail here — it would fail later, when the web parses
    // the contact back and the whole contacts list refuses to render.
    expect(mapCleanCloudCustomer({ ...CUSTOMER, customerEmail: "not an email" })?.email).toBeNull();
    expect(mapCleanCloudCustomer({ ...CUSTOMER, customerEmail: "  " })?.email).toBeNull();
  });

  it("imports a customer with no address at all", () => {
    const contact = mapCleanCloudCustomer({ ...CUSTOMER, customerAddress: null });
    expect(contact?.addressPostcode).toBeNull();
    expect(contact?.firstName).toBe("Alice");
  });
});

describe("birthdayWithoutYear", () => {
  it("uses a leap placeholder year so 29 February survives", () => {
    expect(birthdayWithoutYear(29, 2)).toEqual(
      new Date(Date.UTC(BIRTHDAY_PLACEHOLDER_YEAR, 1, 29)),
    );
  });

  it("stays inside the API's 120-year plausibility bound", () => {
    // A placeholder outside it imports fine and then fails the moment anyone
    // opens the contact and saves it.
    const oldest = new Date();
    oldest.setUTCFullYear(oldest.getUTCFullYear() - 120);
    const placeholder = birthdayWithoutYear(1, 1);
    expect(placeholder!.getTime()).toBeGreaterThan(oldest.getTime());
    expect(placeholder!.getTime()).toBeLessThan(Date.now());
  });

  it.each([
    [31, 4],
    [30, 2],
    [1.5, 1],
    [1, 1.5],
  ])("refuses %p/%p rather than rolling it forward", (day, month) => {
    expect(birthdayWithoutYear(day, month)).toBeNull();
  });
});
