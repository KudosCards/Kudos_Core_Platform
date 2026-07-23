"use client";

import type { DesignDocument } from "@kudos/shared-types";
import { applyMergeTokens } from "@kudos/shared-types";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { createPortal } from "react-dom";

const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

export interface PrintRunCard {
  jobId: string;
  recipientFirstName: string;
  recipientLastName: string;
  recipientCustomFields: Record<string, string> | null;
  occasionType: string | null;
  occasionTitle: string | null;
  occasionDate: string | null;
  savedDesignName: string;
  document: DesignDocument;
}

/** Human occasion label for {occasion}: a custom title wins, else the type
 * (e.g. "birthday") title-cased. */
function occasionLabel(card: PrintRunCard): string | null {
  if (card.occasionTitle) return card.occasionTitle;
  if (!card.occasionType) return null;
  return card.occasionType.charAt(0).toUpperCase() + card.occasionType.slice(1);
}

/**
 * A print-ready sheet of an entire run's personalised card faces, one card per
 * page. Uses the browser's native print → "Save as PDF"; the print CSS in
 * globals.css hides the app so only these cards print. See docs/adr/0032.
 */
export function PrintRunOverlay({
  cards,
  onClose,
}: {
  cards: PrintRunCard[];
  onClose: () => void;
}) {
  // Flag the body so the print stylesheet hides everything except this overlay,
  // and lock scroll while it's open.
  useEffect(() => {
    document.body.setAttribute("data-printing", "");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.removeAttribute("data-printing");
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div data-print-run className="fixed inset-0 z-[60] overflow-auto bg-white">
      {/* Toolbar — screen only; never printed. */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white px-6 py-3 print:hidden">
        <span className="text-sm font-medium text-black">
          {cards.length} personalised card{cards.length === 1 ? "" : "s"} — one per page
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full bg-black px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Print / Save as PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/20 px-4 py-1.5 text-sm text-black hover:bg-black/5"
          >
            Close
          </button>
        </div>
      </div>

      <div className="mx-auto flex max-w-3xl flex-col items-center gap-8 px-6 py-8 print:gap-0 print:p-0">
        {cards.map((card) => (
          <div
            key={card.jobId}
            className="flex break-after-page flex-col items-center gap-2 print:min-h-screen print:justify-center"
          >
            <CardFacePreview
              document={applyMergeTokens(card.document, {
                firstName: card.recipientFirstName,
                lastName: card.recipientLastName,
                occasion: occasionLabel(card),
                occasionDate: card.occasionDate,
                customFields: card.recipientCustomFields,
              })}
              width={360}
            />
            <span className="text-xs text-black/60 print:hidden">
              {card.recipientFirstName} {card.recipientLastName} · {card.savedDesignName}
            </span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
