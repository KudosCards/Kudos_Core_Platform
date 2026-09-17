/**
 * Building a card document from one piece of artwork.
 *
 * Two surfaces do this — the Airtable catalog sync and the member's own
 * "Upload your own artwork" — and until now they did it separately, which is how
 * they came to disagree. ADR 0161 grew the canvas from 450x600 to 450x634 and
 * corrected the catalog builder; the web one kept its own copy of the old
 * numbers and went on emitting a 450x600 image *element*. Both renderers draw an
 * element to whatever box it is given, so every custom upload was squashed by
 * about 5% and left a 34-unit (7.9mm on A6) white strip along the bottom of the
 * front — on the one path a Pro or Centre member has to make a card from their
 * own artwork, and to someone who had exported at exactly the size we ask for.
 *
 * So the builder lives here, once, in the package both surfaces already share.
 * There are no dimensions in it to drift: artwork is a page **background**, which
 * every renderer draws full-bleed and centre-cropped to whatever the card's real
 * proportion is (see `coverCrop`), undistorted at any canvas size. A background
 * is also locked, so text added over it cannot accidentally grab and move it.
 */

import type { DesignDocument, DesignPage } from "./card";

/**
 * A four-page document with `artworkUrl` full-bleed on the front.
 *
 * `insideMessage` seeds an editable text block on the inside-right page — the
 * catalog sheets carry one, a member's upload does not. Passing `null` for the
 * artwork yields a plain white front, which is what a catalog record with no
 * attachment should produce rather than a broken reference.
 */
export function buildCardDocument(
  artworkUrl: string | null,
  insideMessage: string | null = null,
): DesignDocument {
  const frontBackground: DesignPage["background"] = artworkUrl
    ? { type: "image", assetUrl: artworkUrl }
    : undefined;

  const insideRightElements: DesignPage["elements"] = insideMessage
    ? [
        {
          kind: "text",
          id: "inside-message",
          text: insideMessage,
          x: 40,
          y: 40,
          fontFamily: "Helvetica",
          fontSize: 16,
          color: "#1a1a1a",
        },
      ]
    : [];

  return {
    version: 1,
    pages: [
      { name: "front", elements: [], background: frontBackground },
      { name: "inside-left", elements: [] },
      { name: "inside-right", elements: insideRightElements },
      { name: "back", elements: [] },
    ],
  };
}
