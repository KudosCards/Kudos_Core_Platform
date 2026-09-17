import { backArtworkInReservedFooter, backReservedFooterTop } from "@kudos/shared-types";

const top = backReservedFooterTop();

function backPage(page: { background?: unknown; elements?: unknown[] }) {
  return {
    pages: [
      { name: "front", elements: [] },
      { name: "back", background: page.background, elements: page.elements ?? [] },
    ],
  };
}

/**
 * The pre-payment check for artwork that will be clipped off the card back. The
 * editor measures rendered nodes and is the accurate check; this reads the
 * stored document so the send can warn before money changes hands.
 */
describe("backArtworkInReservedFooter", () => {
  it("flags a background, which is how a back most often gets filled", () => {
    // The case the editor's element-only check missed entirely: a full-bleed
    // background always covers the strip, and it is not an "element".
    expect(
      backArtworkInReservedFooter(
        backPage({ background: { type: "image", assetUrl: "https://x/a.png" } }),
      ),
    ).toEqual({ background: true, elements: 0 });
    // A flat colour counts too — it stops at the line like anything else, and a
    // customer who chose a dark back should know it won't reach the bottom.
    expect(
      backArtworkInReservedFooter(backPage({ background: { type: "color", color: "#101010" } }))
        .background,
    ).toBe(true);
  });

  it("counts placed elements that reach into the strip, and only those", () => {
    const result = backArtworkInReservedFooter(
      backPage({
        elements: [
          { kind: "shape", y: top + 10, height: 40 },
          { kind: "image", y: top - 20, height: 60 },
          { kind: "shape", y: 20, height: 40 },
        ],
      }),
    );
    expect(result).toEqual({ background: false, elements: 2 });
  });

  it("measures a QR by its size and text by one line", () => {
    expect(
      backArtworkInReservedFooter(backPage({ elements: [{ kind: "qr", y: top - 10, size: 90 }] }))
        .elements,
    ).toBe(1);
    expect(
      backArtworkInReservedFooter(
        backPage({ elements: [{ kind: "text", y: top - 5, fontSize: 20 }] }),
      ).elements,
    ).toBe(1);
    // A single line that finishes above the line is fine.
    expect(
      backArtworkInReservedFooter(
        backPage({ elements: [{ kind: "text", y: top - 100, fontSize: 20 }] }),
      ).elements,
    ).toBe(0);
  });

  it("says nothing about a design with no back face", () => {
    expect(backArtworkInReservedFooter({ pages: [{ name: "front", elements: [] }] })).toEqual({
      background: false,
      elements: 0,
    });
  });

  it("reads a document it cannot understand as empty, rather than throwing", () => {
    // Every caller reaches this through an unchecked cast off a Prisma `Json`
    // column, so the shape is asserted rather than known. Since this now decides
    // whether a design can be saved and whether an order can be paid for, a
    // TypeError here would be a 500 on a customer's checkout over a document we
    // simply could not read.
    const empty = { background: false, elements: 0 };
    const unreadable = [null, undefined, {}, { pages: null }, { pages: {} }, { pages: "back" }];
    for (const document of unreadable) {
      expect(
        backArtworkInReservedFooter(
          document as unknown as Parameters<typeof backArtworkInReservedFooter>[0],
        ),
      ).toEqual(empty);
    }
    // A back face whose `elements` isn't a list is the same story.
    expect(
      backArtworkInReservedFooter({
        pages: [{ name: "back", elements: null }],
      } as unknown as Parameters<typeof backArtworkInReservedFooter>[0]),
    ).toEqual(empty);
  });

  /**
   * Konva rotates about an element's origin, so a rotated box does not span
   * `y .. y + height`. This check gates the *save*, so reading it as if it did
   * refused designs that were visibly fine and passed ones that print clipped.
   * The editor's own guide measures the rendered node and always had this right;
   * these pin the two to the same answer.
   */
  describe("rotation", () => {
    it("clears a logo rotated so that it paints upward, away from the band", () => {
      // A 200x60 image at y=480 rotated 270 paints 280..480 — a clear 25 units
      // above the line. Before this it was refused, and the message told the
      // customer to move something already where it should be.
      expect(top).toBeCloseTo(505.49, 1);
      expect(
        backArtworkInReservedFooter(
          backPage({
            elements: [{ kind: "image", x: 100, y: 480, width: 200, height: 60, rotation: 270 }],
          }),
        ),
      ).toEqual({ background: false, elements: 0 });
    });

    it("catches text rotated down into the band, which used to save and print clipped", () => {
      // fontSize 20 at y=400 rotated 90 paints downward by its wrap width.
      expect(
        backArtworkInReservedFooter(
          backPage({
            elements: [{ kind: "text", x: 40, y: 400, width: 200, fontSize: 20, rotation: 90 }],
          }),
        ),
      ).toEqual({ background: false, elements: 1 });
    });

    it("leaves an unrotated element judged exactly as before", () => {
      const intoBand = backPage({
        elements: [{ kind: "image", x: 10, y: top + 5, width: 100, height: 40 }],
      });
      const clear = backPage({
        elements: [{ kind: "image", x: 10, y: top - 80, width: 100, height: 40 }],
      });

      expect(backArtworkInReservedFooter(intoBand).elements).toBe(1);
      expect(backArtworkInReservedFooter(clear).elements).toBe(0);
    });

    it("turns the same box over and the verdict flips with it", () => {
      // Identical element, identical origin, 180 degrees apart: unrotated it
      // hangs down into the band, turned over it hangs up out of it. Nothing but
      // the rotation differs, so this fails the moment rotation stops being read.
      const box = { kind: "image", x: 10, y: top - 5, width: 100, height: 60 };

      expect(backArtworkInReservedFooter(backPage({ elements: [box] })).elements).toBe(1);
      expect(
        backArtworkInReservedFooter(backPage({ elements: [{ ...box, rotation: 180 }] })).elements,
      ).toBe(0);
    });

    it("keeps the origin itself in the reckoning when the box swings above it", () => {
      // Between 180 and 270 degrees every *other* corner lands above the origin,
      // so the lowest point of the box is the origin — and the origin is here,
      // inside the band. Read only the other three corners and the element looks
      // like it floats 28 units clear of a line it is actually sitting on.
      expect(
        backArtworkInReservedFooter(
          backPage({
            elements: [
              { kind: "image", x: 10, y: top + 20, width: 100, height: 40, rotation: 225 },
            ],
          }),
        ).elements,
      ).toBe(1);
    });

    it("uses the QR's own side length as its width", () => {
      // A QR carries `size`, not width/height, so a rotated one needs that read
      // for both axes or its span comes out zero-wide and always clears.
      const qr = { kind: "qr", x: 10, y: top - 5, size: 40 };

      expect(backArtworkInReservedFooter(backPage({ elements: [qr] })).elements).toBe(1);
      expect(
        backArtworkInReservedFooter(backPage({ elements: [{ ...qr, rotation: 270 }] })).elements,
      ).toBe(0);
      // Turned the other way it hangs down by its own side length — which only
      // works if `size` is read as the width too. At 270 a zero width gives the
      // same answer as the real one, so that case alone proves nothing.
      expect(
        backArtworkInReservedFooter(backPage({ elements: [{ ...qr, rotation: 90 }] })).elements,
      ).toBe(1);
    });
  });
});
