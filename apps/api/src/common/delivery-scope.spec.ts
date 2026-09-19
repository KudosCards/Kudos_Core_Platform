import { UK_COUNTRY_VALUES, isUkCountry, DELIVERY_COUNTRY_CODE } from "@kudos/shared-types";

/**
 * What counts as a UK address, used by both the send path's refusal and the
 * readiness counts that tell a customer how many contacts are ready.
 *
 * They disagreed for a long time: `bulkSend` refused a non-GB recipient while
 * every count looked only at line 1, town and postcode. See
 * docs/uk-scope-messaging-plan.md.
 */
describe("isUkCountry", () => {
  it.each([null, undefined, "", "   "])("treats an unset country (%p) as the UK", (value) => {
    // Load-bearing. `addressCountry` is nullable with a "GB" default, so every
    // contact added by hand or imported from CSV before the column was
    // populated holds null. Reading that as foreign makes every one of them
    // unmailable overnight — the worst thing this rule could do.
    expect(isUkCountry(value)).toBe(true);
  });

  it.each([...UK_COUNTRY_VALUES])("accepts %s", (value) => {
    expect(isUkCountry(value)).toBe(true);
  });

  it("accepts the spelling HubSpot actually stores", () => {
    // The live defect this fixed: HubSpot's standard `country` property reads
    // "United Kingdom", the send path compared it to "GB" exactly, and a
    // perfectly deliverable synced contact was refused as a "Non-UK address".
    expect(isUkCountry("United Kingdom")).toBe(true);
  });

  it.each(["gb", "uk", "united kingdom", "  United Kingdom  ", "ENGLAND"])(
    "does not care about case or padding (%p)",
    (value) => {
      expect(isUkCountry(value)).toBe(true);
    },
  );

  it.each(["US", "United States", "IE", "Ireland", "FR", "Australia"])(
    "refuses %s, which we do not post to",
    (value) => {
      expect(isUkCountry(value)).toBe(false);
    },
  );

  it("does not accept a country that merely contains one we do", () => {
    // A substring match would let "United States" through on "United".
    expect(isUkCountry("United States of America")).toBe(false);
    expect(isUkCountry("New England")).toBe(false);
  });

  it("includes the ISO code the column defaults to", () => {
    expect(UK_COUNTRY_VALUES).toContain(DELIVERY_COUNTRY_CODE);
  });
});
