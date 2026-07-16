import type { DesignDocument } from "@kudos/shared-types";

// Matches the web canvas (apps/web/.../design-canvas.tsx CANVAS_WIDTH/HEIGHT).
// Kept in sync by hand — a mismatch only affects where the background sits,
// not correctness, and the editor lets the user nudge it.
const CANVAS_WIDTH = 450;
const CANVAS_HEIGHT = 600;

/**
 * Builds the editable document for an Airtable-sourced card: the artwork is a
 * full-bleed background image on the front page, and the customer can then add
 * or move text over it in the canvas editor (the "pick, then edit" model — see
 * docs/adr/0011-airtable-catalog-sync.md). The inside message, if the sheet
 * carries one, seeds an editable text block on the inside-right page.
 */
export function buildCardDocument(
  imageUrl: string | null,
  insideMessage: string | null,
): DesignDocument {
  const frontElements: DesignDocument["pages"][number]["elements"] = imageUrl
    ? [
        {
          kind: "image",
          id: "artwork",
          assetUrl: imageUrl,
          x: 0,
          y: 0,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          rotation: 0,
        },
      ]
    : [];

  const insideRightElements: DesignDocument["pages"][number]["elements"] = insideMessage
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
      { name: "front", elements: frontElements },
      { name: "inside-left", elements: [] },
      { name: "inside-right", elements: insideRightElements },
      { name: "back", elements: [] },
    ],
  };
}
