import { suggestMapping, remapRow } from "./csv-mapping.util";

describe("suggestMapping", () => {
  it("matches real-world header variants regardless of case/spacing/punctuation", () => {
    const mapping = suggestMapping([
      "First Name",
      "Surname",
      "DOB",
      "Address Line 1",
      "Address Line 2",
      "Town/City",
      "Post Code",
      "Email Address",
    ]);
    expect(mapping).toEqual({
      firstName: "First Name",
      lastName: "Surname",
      dateOfBirth: "DOB",
      addressLine1: "Address Line 1",
      addressLine2: "Address Line 2",
      addressCity: "Town/City",
      postcode: "Post Code",
      email: "Email Address",
    });
  });

  it("matches our own canonical headers exactly", () => {
    expect(
      suggestMapping(["firstName", "lastName", "dateOfBirth", "postcode", "email"]),
    ).toEqual({
      firstName: "firstName",
      lastName: "lastName",
      dateOfBirth: "dateOfBirth",
      postcode: "postcode",
      email: "email",
    });
  });

  it("leaves unknown columns unmapped and never assigns one column to two fields", () => {
    const mapping = suggestMapping(["Forename", "Loyalty Points", "Region"]);
    expect(mapping.firstName).toBe("Forename");
    expect(mapping.lastName).toBeUndefined();
    // "Loyalty Points"/"Region" match nothing.
    const assigned = Object.values(mapping);
    expect(new Set(assigned).size).toBe(assigned.length);
  });
});

describe("remapRow", () => {
  it("rewrites a row's keys from source columns to our canonical field names", () => {
    const row = { "First Name": "Ada", Surname: "Lovelace", "Post Code": "SW1A 1AA" };
    expect(
      remapRow(row, { firstName: "First Name", lastName: "Surname", postcode: "Post Code" }),
    ).toEqual({ firstName: "Ada", lastName: "Lovelace", postcode: "SW1A 1AA" });
  });

  it("omits fields whose mapped column is missing from the row", () => {
    const row = { "First Name": "Ada" };
    expect(remapRow(row, { firstName: "First Name", email: "Email" })).toEqual({
      firstName: "Ada",
    });
  });
});
