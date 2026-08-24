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
});
