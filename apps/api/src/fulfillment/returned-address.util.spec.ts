import { addressKey, isReturnedAddress, type AddressParts } from "./returned-address.util";

/**
 * The rule that decides whether a queued card is addressed to somewhere Royal
 * Mail already handed back.
 *
 * A card returned in October flags the contact, which pauses their automatic
 * sends — and does nothing about the card already paid for, already queued, and
 * addressed to the same place, which posts in December. See
 * docs/returned-address-hold-plan.md.
 */

const at = (line1: string, postcode: string): AddressParts => ({
  shippingAddressLine1: line1,
  shippingAddressPostcode: postcode,
});

describe("addressKey", () => {
  it("reads the same doorway typed differently as one address", () => {
    expect(addressKey(at(" 12  high street ", "hu8 9dj"))).toBe(
      addressKey(at("12 High Street", "HU8 9DJ")),
    );
  });

  it("keeps two different doorways apart", () => {
    expect(addressKey(at("12 High Street", "HU8 9DJ"))).not.toBe(
      addressKey(at("14 High Street", "HU8 9DJ")),
    );
    expect(addressKey(at("12 High Street", "HU8 9DJ"))).not.toBe(
      addressKey(at("12 High Street", "HU8 9DX")),
    );
  });
});

describe("isReturnedAddress", () => {
  const returned = [at("12 High Street", "HU8 9DJ")];

  it("holds a card going to the address that came back", () => {
    expect(isReturnedAddress(at("12 High Street", "HU8 9DJ"), returned)).toBe(true);
  });

  it("holds it however the address was typed the second time", () => {
    // The same place re-keyed by hand on a later order. A hold that a stray
    // space defeats is not a hold.
    expect(isReturnedAddress(at("12  HIGH STREET", "hu8  9dj"), returned)).toBe(true);
  });

  it("leaves a card at a different address alone", () => {
    // The falsifying case. A contact who has moved has cards at the new
    // address too, and holding those would stop the very thing that fixes it.
    expect(isReturnedAddress(at("4 Mill Lane", "HU5 2QR"), returned)).toBe(false);
  });

  it("leaves every card alone when nothing has come back", () => {
    expect(isReturnedAddress(at("12 High Street", "HU8 9DJ"), [])).toBe(false);
  });

  it("holds when any one of several returns matches", () => {
    const twice = [at("4 Mill Lane", "HU5 2QR"), at("12 High Street", "HU8 9DJ")];
    expect(isReturnedAddress(at("12 High Street", "HU8 9DJ"), twice)).toBe(true);
  });
});
