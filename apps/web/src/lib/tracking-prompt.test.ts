import { promptTrackingReference } from "./tracking-prompt";

describe("tracking reference prompt", () => {
  afterEach(() => jest.restoreAllMocks());

  function answer(value: string | null) {
    jest.spyOn(window, "prompt").mockReturnValue(value);
  }

  it("returns null when the operator backs out", () => {
    // Cancel and Escape both return null. Folding that into "" — as `?? ""`
    // did — posts the card anyway: postedAt is stamped, the row leaves the
    // queue, and there is no reverse transition in the product.
    answer(null);
    expect(promptTrackingReference()).toBeNull();
  });

  it("returns an empty body when the field is left blank", () => {
    // Deliberately blank is a real answer: post it, with no tracking reference.
    answer("");
    expect(promptTrackingReference()).toEqual({});
    answer("   ");
    expect(promptTrackingReference()).toEqual({});
  });

  it("returns the trimmed reference when one is given", () => {
    answer("  AB123456789GB  ");
    expect(promptTrackingReference()).toEqual({ trackingReference: "AB123456789GB" });
  });
});
