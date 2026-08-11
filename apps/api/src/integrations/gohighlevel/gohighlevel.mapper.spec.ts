import {
  DEFAULT_GOHIGHLEVEL_MAPPING,
  mapGoHighLevelContact,
  type GoHighLevelFieldMapping,
} from "./gohighlevel.mapper";
import type { GoHighLevelContact } from "./gohighlevel-client";

describe("mapGoHighLevelContact", () => {
  const contact: GoHighLevelContact = {
    id: "ghl-123",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    dateOfBirth: "1990-05-20T00:00:00.000Z",
    address1: "12 Analytical Way",
    city: "London",
    postalCode: "SW1A 1AA",
    country: "GB",
  };

  it("maps standard fields with the default mapping", () => {
    const result = mapGoHighLevelContact(contact, DEFAULT_GOHIGHLEVEL_MAPPING);
    expect(result).toEqual({
      externalId: "ghl-123",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      dateOfBirth: new Date("1990-05-20T00:00:00.000Z"),
      addressLine1: "12 Analytical Way",
      addressLine2: null,
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
      addressCountry: "GB",
    });
  });

  it("returns null when the required name is missing", () => {
    expect(
      mapGoHighLevelContact({ id: "x", firstName: "Only" }, DEFAULT_GOHIGHLEVEL_MAPPING),
    ).toBeNull();
    expect(
      mapGoHighLevelContact({ id: "x", email: "no@name.com" }, DEFAULT_GOHIGHLEVEL_MAPPING),
    ).toBeNull();
  });

  it("trims blank scalars to null and leaves a bad date null", () => {
    const result = mapGoHighLevelContact(
      { id: "y", firstName: "Grace", lastName: "Hopper", email: "  ", dateOfBirth: "not-a-date" },
      DEFAULT_GOHIGHLEVEL_MAPPING,
    );
    expect(result?.email).toBeNull();
    expect(result?.dateOfBirth).toBeNull();
  });

  it("honours a custom field mapping", () => {
    const mapping: GoHighLevelFieldMapping = {
      ...DEFAULT_GOHIGHLEVEL_MAPPING,
      firstName: "first_name",
      lastName: "surname",
    };
    const result = mapGoHighLevelContact(
      { id: "z", first_name: "Katherine", surname: "Johnson" },
      mapping,
    );
    expect(result).toMatchObject({ firstName: "Katherine", lastName: "Johnson" });
  });
});
