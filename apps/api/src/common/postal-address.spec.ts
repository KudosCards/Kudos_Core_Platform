import { hasPostalAddress } from "@kudos/shared-types";

describe("hasPostalAddress", () => {
  const full = {
    addressLine1: "1 Test Street",
    addressCity: "London",
    addressPostcode: "SW1A 1AA",
  };

  it("accepts the three fields the send path needs", () => {
    expect(hasPostalAddress(full)).toBe(true);
  });

  it.each(["addressLine1", "addressCity", "addressPostcode"] as const)(
    "refuses when %s is missing",
    (field) => {
      expect(hasPostalAddress({ ...full, [field]: null })).toBe(false);
      expect(hasPostalAddress({ ...full, [field]: "" })).toBe(false);
    },
  );

  // The drift this exists to end: whitespace was complete to the API's gate and
  // missing to the contact screen.
  it("does not accept whitespace as an address", () => {
    expect(hasPostalAddress({ ...full, addressPostcode: "   " })).toBe(false);
  });

  // Plenty of UK addresses have neither, and requiring them would report
  // perfectly postable contacts as unreachable.
  it("does not require a second line or a country", () => {
    expect(hasPostalAddress({ ...full, addressLine2: null, country: null } as never)).toBe(true);
  });

  it("treats no recipient at all as no address", () => {
    expect(hasPostalAddress(null)).toBe(false);
    expect(hasPostalAddress(undefined)).toBe(false);
  });
});
