import { BadRequestException } from "@nestjs/common";
import { parseLocationId } from "./parse-location-id";

const ID = "ve9EPM428h8vShlRW1KT";

describe("parseLocationId", () => {
  it("takes a bare id", () => {
    expect(parseLocationId(ID)).toBe(ID);
    expect(parseLocationId(`  ${ID}  `)).toBe(ID);
  });

  it.each([
    `https://app.gohighlevel.com/v2/location/${ID}/dashboard`,
    `https://app.gohighlevel.com/v2/location/${ID}/contacts/smart_list/All`,
    `app.gohighlevel.com/v2/location/${ID}`,
    `https://my.agency-white-label.com/v2/location/${ID}/dashboard`,
    `https://app.gohighlevel.com/v2/location/${ID}/settings?tab=api`,
  ])("takes a pasted dashboard address (%s)", (url) => {
    // The id lives in the URL bar, which is where the customer is told to find
    // it. Asking for "the bit after /location/" and then refusing the address
    // it came from turns a two-minute setup into a support thread.
    expect(parseLocationId(url)).toBe(ID);
  });

  it("reads the sub-account out of a white-labelled domain too", () => {
    // Agencies serve HighLevel under their own domain; the path is the same.
    expect(parseLocationId(`https://crm.example.co.uk/v2/location/${ID}/dashboard`)).toBe(ID);
  });

  it.each([null, undefined, "", "   "])("refuses nothing at all (%p)", (input) => {
    expect(() => parseLocationId(input)).toThrow(BadRequestException);
  });

  it("says an address has no sub-account in it, rather than 'invalid'", () => {
    // The likely mistake is the wrong page — an agency dashboard, a settings
    // screen — and naming that is what gets somebody to the right one.
    expect(() => parseLocationId("https://app.gohighlevel.com/v2/agency/dashboard")).toThrow(
      /doesn't contain a sub-account ID/,
    );
  });

  it("says a bare string is not an id, and where to find one", () => {
    expect(() => parseLocationId("my sub account")).toThrow(/part after \/location\//);
  });

  it.each(["short", "x".repeat(65), "two words", "has/a/slash", "has?query"])(
    "refuses %p, which is not an id shape",
    (input) => {
      expect(() => parseLocationId(input)).toThrow(BadRequestException);
    },
  );

  it.each(["loc-abc-123", "loc_abc_123"])("accepts %p rather than inventing a rule", (input) => {
    // Every id seen in the wild is alphanumeric and it is tempting to enforce
    // that. But HighLevel does not document the format, this cannot be checked
    // from here, and refusing a working id is a worse failure than accepting a
    // wrong one — the token is verified against the sub-account before anything
    // is stored, so a wrong id fails anyway, with HighLevel's own words.
    expect(parseLocationId(input)).toBe(input);
  });

  it("never names the provider by the word their policy forbids", () => {
    // ADR 0234: the product is sold white-label, so an agency's client may know
    // it only as their agency's CRM.
    try {
      parseLocationId("");
    } catch (error) {
      expect((error as Error).message).toContain("LeadConnector");
      expect((error as Error).message).not.toMatch(/highlevel/i);
    }
    expect.assertions(2);
  });
});
