import {
  DEFAULT_HUBSPOT_MAPPING,
  hubspotProperties,
  mapHubSpotContact,
} from "./hubspot.mapper";
import type { HubSpotContact } from "./hubspot-client";

function contact(properties: Record<string, unknown>): HubSpotContact {
  return { id: "1", properties };
}

describe("mapHubSpotContact", () => {
  it("maps standard properties to a normalized contact", () => {
    const result = mapHubSpotContact(
      contact({
        firstname: "Grace",
        lastname: "Hopper",
        email: "grace@example.com",
        zip: "SW1A 1AA",
      }),
      DEFAULT_HUBSPOT_MAPPING,
    );
    expect(result).toMatchObject({
      externalId: "1",
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@example.com",
      addressPostcode: "SW1A 1AA",
    });
  });

  it("returns null when the contact has no first or last name (unaddressable)", () => {
    expect(mapHubSpotContact(contact({ firstname: "Grace" }), DEFAULT_HUBSPOT_MAPPING)).toBeNull();
    expect(mapHubSpotContact(contact({ lastname: "Hopper" }), DEFAULT_HUBSPOT_MAPPING)).toBeNull();
  });

  it("parses an ISO date_of_birth", () => {
    const result = mapHubSpotContact(
      contact({ firstname: "A", lastname: "B", date_of_birth: "2016-12-09" }),
      DEFAULT_HUBSPOT_MAPPING,
    );
    expect(result?.dateOfBirth?.getUTCFullYear()).toBe(2016);
  });

  it("parses an epoch-milliseconds date_of_birth (HubSpot date properties)", () => {
    const epoch = Date.UTC(2015, 5, 1); // 2015-06-01
    const result = mapHubSpotContact(
      contact({ firstname: "A", lastname: "B", date_of_birth: String(epoch) }),
      DEFAULT_HUBSPOT_MAPPING,
    );
    expect(result?.dateOfBirth?.getUTCFullYear()).toBe(2015);
  });

  it("leaves date null when the value is unparseable", () => {
    const result = mapHubSpotContact(
      contact({ firstname: "A", lastname: "B", date_of_birth: "not-a-date" }),
      DEFAULT_HUBSPOT_MAPPING,
    );
    expect(result?.dateOfBirth).toBeNull();
  });

  it("honours a custom mapping over the defaults", () => {
    const result = mapHubSpotContact(
      contact({ fname: "Ada", lname: "Lovelace" }),
      { ...DEFAULT_HUBSPOT_MAPPING, firstName: "fname", lastName: "lname" },
    );
    expect(result).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
  });
});

describe("hubspotProperties", () => {
  it("returns the distinct property names to request", () => {
    const props = hubspotProperties(DEFAULT_HUBSPOT_MAPPING);
    expect(props).toEqual(expect.arrayContaining(["firstname", "lastname", "email", "zip"]));
    expect(new Set(props).size).toBe(props.length); // no duplicates
  });
});
