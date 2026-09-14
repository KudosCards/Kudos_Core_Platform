"use client";

import type { DesignDocument } from "@kudos/shared-types";
import { BACK_RESERVED_FOOTER_MM } from "@kudos/shared-types";
import dynamic from "next/dynamic";
import { facesOf } from "@/components/card-preview-lightbox";
import { CardTextReadout } from "./card-text-readout";

// Client-only: Konva touches canvas APIs.
const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

const FACE_LABEL: Record<string, string> = {
  front: "Front",
  "inside-left": "Inside left",
  "inside-right": "Inside right",
  back: "Back",
};

/**
 * Every face of one card, each with what it says in words.
 *
 * The fulfilment queue's **Preview card** used to show the front alone, under
 * the words "printed exactly as shown". On the card that prompted this, the
 * front was perfect and the damage was on the inside right — so an operator
 * could look straight at a broken card, read a promise that it was accurate,
 * and pass it.
 *
 * Stacked rather than a flip viewer: an operator opens this to find something
 * wrong, and a face behind a click is a face nobody checks. The readout comes
 * with each one for the same reason the print overlay carries it — the render is
 * the thing under suspicion, so reading the text back is the only representation
 * that can answer "which message is on here twice?".
 *
 * Pass a document already run through `applyMergeTokens`: what is shown is this
 * recipient's card, not the design.
 */
export function WholeCardPreview({
  document,
  width = 300,
}: {
  document: DesignDocument;
  width?: number;
}) {
  const faces = facesOf(document);

  return (
    <div className="flex flex-col items-center gap-6">
      {faces.map((face) => (
        <div key={face} className="flex w-full flex-col items-center gap-2">
          <span className="text-xs font-medium text-foreground/60">{FACE_LABEL[face] ?? face}</span>
          <CardFacePreview document={document} width={width} face={face} />
          {/* The back previews with its bottom strip blank because that is what
              prints — the stock already carries the Kudos logo and QR there.
              Unexplained it reads as a rendering fault, which is how it reached
              support the first time. */}
          {face === "back" && (
            <p className="max-w-xs text-center text-xs text-foreground/60">
              The bottom {BACK_RESERVED_FOOTER_MM}mm is blank here because the card already has the
              Kudos logo and QR code printed there.
            </p>
          )}
          <CardTextReadout document={document} face={face} />
        </div>
      ))}
    </div>
  );
}
