import { findUkPostcode } from "@kudos/shared-types";
import { parseAddress } from "./parse-address";

describe("findUkPostcode", () => {
  it("finds a postcode inside free text", () => {
    expect(findUkPostcode("12 Acacia Avenue, London SW1A 1AA")?.postcode).toBe("SW1A 1AA");
  });

  it.each([
    ["M1 1AE", "M1 1AE"],
    ["B33 8TH", "B33 8TH"],
    ["CR2 6XH", "CR2 6XH"],
    ["DN55 1PT", "DN55 1PT"],
    ["EC1A 1BB", "EC1A 1BB"],
    ["W1A 0AX", "W1A 0AX"],
    ["sw1a1aa", "sw1a1aa"],
  ])("matches the real postcode format %s", (input, expected) => {
    expect(findUkPostcode(`Somewhere, ${input}`)?.postcode).toBe(expected);
  });

  it("takes the LAST match, because an address ends with its postcode", () => {
    // A street name that happens to look like a postcode is not the postcode.
    expect(findUkPostcode("SW1A 1AA Court, London, N1 9GU")?.postcode).toBe("N1 9GU");
  });

  it("does not read a postcode out of the middle of a longer token", () => {
    expect(findUkPostcode("ORDERSW1A1AAX")).toBeNull();
  });

  it("returns null when there is no postcode", () => {
    expect(findUkPostcode("12 Acacia Avenue, London")).toBeNull();
  });

  it("gives the same answer twice for the same input", () => {
    // A shared global regex carries lastIndex between calls; this is the test
    // that would catch one being reintroduced.
    const text = "12 Acacia Avenue, London SW1A 1AA";
    expect(findUkPostcode(text)).toEqual(findUkPostcode(text));
  });
});

describe("parseAddress", () => {
  it("splits a three-part address", () => {
    expect(parseAddress("12 Acacia Avenue, London, SW1A 1AA")).toEqual({
      addressLine1: "12 Acacia Avenue",
      addressLine2: null,
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
    });
  });

  it("puts everything between the first part and the town on line 2", () => {
    expect(parseAddress("Flat 4, 12 Acacia Avenue, Camden, London, NW1 8AB")).toEqual({
      addressLine1: "Flat 4",
      addressLine2: "12 Acacia Avenue, Camden",
      addressCity: "London",
      addressPostcode: "NW1 8AB",
    });
  });

  it("treats line breaks as separators, like commas", () => {
    expect(parseAddress("12 Acacia Avenue\nLondon\nSW1A 1AA")).toEqual({
      addressLine1: "12 Acacia Avenue",
      addressLine2: null,
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
    });
  });

  it("leaves the town empty rather than guessing it from the last word", () => {
    // "12 Acacia Avenue SW1A 1AA" has no comma, so the town is unknown. Taking
    // the word before the postcode would print "Avenue" on an envelope — which
    // looks right on screen and is wrong in the post. The contact still
    // imports; readinessFor counts it as not yet postable.
    expect(parseAddress("12 Acacia Avenue SW1A 1AA")).toEqual({
      addressLine1: "12 Acacia Avenue",
      addressLine2: null,
      addressCity: null,
      addressPostcode: "SW1A 1AA",
    });
  });

  it("drops a country trailing after the postcode", () => {
    expect(parseAddress("12 Acacia Avenue, London, SW1A 1AA, United Kingdom")).toEqual({
      addressLine1: "12 Acacia Avenue",
      addressLine2: null,
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
    });
  });

  it("normalises the postcode to its printed form", () => {
    expect(parseAddress("12 Acacia Avenue, London, sw1a1aa").addressPostcode).toBe("SW1A 1AA");
    expect(parseAddress("12 Acacia Avenue, London, n1  9gu").addressPostcode).toBe("N1 9GU");
  });

  it("keeps what it has when there is no postcode at all", () => {
    expect(parseAddress("12 Acacia Avenue, London")).toEqual({
      addressLine1: "12 Acacia Avenue",
      addressLine2: null,
      addressCity: "London",
      addressPostcode: null,
    });
  });

  it("collapses stray whitespace and empty parts", () => {
    expect(parseAddress("  12   Acacia Avenue ,, London ,, SW1A 1AA ")).toEqual({
      addressLine1: "12 Acacia Avenue",
      addressLine2: null,
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
    });
  });

  it.each([null, undefined, "", "   "])("returns an empty address for %p", (input) => {
    expect(parseAddress(input)).toEqual({
      addressLine1: null,
      addressLine2: null,
      addressCity: null,
      addressPostcode: null,
    });
  });

  it("caps each field at the column limit the wire contract enforces", () => {
    // An over-long value imports fine and then breaks the contacts list, which
    // parses every recipient back through recipientSchema.
    const long = "x".repeat(400);
    const parsed = parseAddress(`${long}, ${long}, ${long}, SW1A 1AA`);
    expect(parsed.addressLine1).toHaveLength(200);
    expect(parsed.addressLine2).toHaveLength(200);
    expect(parsed.addressCity).toHaveLength(120);
  });
});
