import { buildCardDocument, designDocumentSchema, CARD_HEIGHT } from "@kudos/shared-types";

/**
 * One builder for both surfaces that make a card out of a single piece of
 * artwork — the catalog sync and the member's own upload.
 *
 * They used to be two, and they drifted: ADR 0161 grew the canvas to 450x634 and
 * corrected the catalog copy while the web copy went on emitting a 450x600 image
 * *element*, squashing every custom upload and leaving a white strip under it.
 * These pin the properties that made that possible.
 */
describe("buildCardDocument", () => {
  it("puts the artwork behind the card, not in a box on it", () => {
    // The whole fix. An element is drawn to whatever box it is given, so it is
    // stretched; a background is cover-cropped to the card, so it never is.
    const front = buildCardDocument("https://x.test/art.png").pages[0]!;

    expect(front.name).toBe("front");
    expect(front.background).toEqual({ type: "image", assetUrl: "https://x.test/art.png" });
    expect(front.elements).toEqual([]);
  });

  it("carries no dimensions at all, so there is nothing left to drift", () => {
    // The 450x600 constants outlived the canvas they described because they were
    // written down twice. A document with no width or height in it cannot go
    // stale when the canvas changes again.
    const json = JSON.stringify(buildCardDocument("https://x.test/art.png", "Many happy returns"));

    expect(json).not.toMatch(/"width"/);
    expect(json).not.toMatch(/"height"/);
    expect(json).not.toContain("600");
    expect(json).not.toContain(String(CARD_HEIGHT));
  });

  it("produces a document the shared schema accepts", () => {
    // Both call sites POST this straight at an endpoint that parses it. A shape
    // the schema rejects is a 400 the member cannot do anything about.
    expect(() =>
      designDocumentSchema.parse(buildCardDocument("https://x.test/art.png", "Hello")),
    ).not.toThrow();
    expect(() => designDocumentSchema.parse(buildCardDocument(null))).not.toThrow();
  });

  it("gives every card all four faces, in order", () => {
    expect(buildCardDocument("https://x.test/a.png").pages.map((p) => p.name)).toEqual([
      "front",
      "inside-left",
      "inside-right",
      "back",
    ]);
  });

  it("seeds the inside message when there is one, and nothing when there isn't", () => {
    const withMessage = buildCardDocument("https://x.test/a.png", "Many happy returns");
    const seeded = withMessage.pages[2]!.elements[0]!;
    expect(seeded).toMatchObject({ kind: "text", text: "Many happy returns" });

    // A member's upload passes no message, and must not get an empty text box.
    expect(buildCardDocument("https://x.test/a.png").pages[2]!.elements).toEqual([]);
  });

  it("leaves the front plain rather than broken when there is no artwork", () => {
    // A catalog record with no attachment. A dangling reference would render as
    // a blank card with a warning in the log; no background renders as white.
    expect(buildCardDocument(null).pages[0]!.background).toBeUndefined();
  });
});
