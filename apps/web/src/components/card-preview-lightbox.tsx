"use client";

import type { DesignDocument, DesignPage } from "@kudos/shared-types";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Client-only (Konva touches canvas APIs). Encapsulated here so callers can
// import the flip viewer / lightbox normally.
const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

/** Reading order of a card's faces: cover, then the inside spread, then back. */
const FACE_ORDER: DesignPage["name"][] = ["front", "inside-left", "inside-right", "back"];
const FACE_LABEL: Record<DesignPage["name"], string> = {
  front: "Front",
  "inside-left": "Inside left",
  "inside-right": "Inside right",
  back: "Back",
};

/** The faces a design actually has, in reading order (front → inside → back).
 * A design may have only a front, or a front + inside, so we render what exists. */
export function facesOf(document: DesignDocument): DesignPage["name"][] {
  const present = new Set(document.pages.map((page) => page.name));
  return FACE_ORDER.filter((name) => present.has(name));
}

/** A short human hint for how many faces beyond the front a design has, e.g.
 * "+2 inside" — shown on a preview tile so a sender knows there's more to see. */
export function insideFacesHint(document: DesignDocument): string | null {
  const inside = facesOf(document).filter((f) => f !== "front");
  if (inside.length === 0) return null;
  const hasInside = inside.some((f) => f === "inside-left" || f === "inside-right");
  const hasBack = inside.includes("back");
  if (hasInside && hasBack) return "inside + back";
  if (hasInside) return "inside message";
  return "back";
}

const arrowClass =
  "flex size-9 items-center justify-center rounded-full border border-border text-lg " +
  "hover:bg-foreground/[0.04] disabled:opacity-40";

/**
 * A flip-through viewer of every face a (merged) design has — front cover, the
 * inside message, and back — so a sender can review the *whole* card, not just
 * the cover, before paying. Pure display; pass a document already run through
 * applyMergeTokens.
 */
export function CardFlip({ document, width = 300 }: { document: DesignDocument; width?: number }) {
  const faces = facesOf(document);
  const [index, setIndex] = useState(0);
  const safeIndex = faces.length > 0 ? index % faces.length : 0;
  const face = faces[safeIndex] ?? "front";
  const many = faces.length > 1;

  function step(delta: number) {
    setIndex((i) => (i + delta + faces.length) % faces.length);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <CardFacePreview document={document} width={width} face={face} />
      <div className="flex items-center gap-3">
        {many && (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous face"
            className={arrowClass}
          >
            ‹
          </button>
        )}
        <span className="min-w-24 text-center text-sm text-muted">
          {FACE_LABEL[face]}
          {many ? ` · ${safeIndex + 1}/${faces.length}` : ""}
        </span>
        {many && (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next face"
            className={arrowClass}
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Modal wrapper: a large flip viewer for one recipient's personalised card,
 * with the exact name + postal address it will be sent to shown alongside — so a
 * sender verifies the card *and* the envelope together. Esc or backdrop closes.
 */
export function CardPreviewLightbox({
  document,
  title,
  subtitle,
  onClose,
}: {
  document: DesignDocument;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="card flex max-h-full w-full max-w-md flex-col gap-4 overflow-auto p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{title}</h2>
            {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-sm hover:bg-foreground/[0.04]"
          >
            ✕
          </button>
        </div>
        <CardFlip document={document} width={340} />
      </div>
    </div>
  );
}
