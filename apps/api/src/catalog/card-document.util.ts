import type { DesignDocument, DesignPage } from "@kudos/shared-types";

/**
 * Builds the editable document for an Airtable-sourced card: the artwork is a
 * full-bleed background image on the front page, and the customer can then add
 * or move text over it in the canvas editor (the "pick, then edit" model — see
 * docs/adr/0011-airtable-catalog-sync.md). The inside message, if the sheet
 * carries one, seeds an editable text block on the inside-right page.
 *
 * The artwork is a page `background` (not an image element): the renderer draws
 * a background to the canvas's real CARD_WIDTH × CARD_HEIGHT and cover-crops it
 * (see PageBackground / coverCrop), so it stays full-bleed and undistorted at
 * whatever proportion the card is authored at — including the A6 canvas (ADR
 * 0161). A fixed-size image element, by contrast, was pinned to the old 450×600
 * and left a blank strip once the canvas grew taller. As a background it's also
 * locked, so a customer adding text on top can't accidentally grab or move it.
 */
export function buildCardDocument(
  imageUrl: string | null,
  insideMessage: string | null,
): DesignDocument {
  const frontBackground: DesignPage["background"] = imageUrl
    ? { type: "image", assetUrl: imageUrl }
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
