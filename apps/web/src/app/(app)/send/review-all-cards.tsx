"use client";

import type { Recipient, SavedDesign } from "@kudos/shared-types";
import { applyMergeTokens, CARD_HEIGHT, CARD_WIDTH } from "@kudos/shared-types";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardPreviewLightbox, insideFacesHint } from "@/components/card-preview-lightbox";

const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

/** Tile render width; the placeholder matches the card's aspect ratio so the
 * grid doesn't reflow when a preview mounts. */
const TILE_WIDTH = 150;
const TILE_HEIGHT = Math.round((TILE_WIDTH * CARD_HEIGHT) / CARD_WIDTH);

function shortAddress(recipient: Recipient): string {
  return [recipient.addressCity, recipient.addressPostcode].filter(Boolean).join(" · ");
}

/**
 * One card tile that only mounts its (heavy) Konva preview while near the
 * viewport, unmounting again once scrolled well past — so reviewing a run of
 * thousands keeps only a few dozen live canvases at a time (the "virtualized
 * live render" half of ADR 0118's hybrid approach). A same-size placeholder
 * holds the slot so scrolling stays stable.
 */
function LazyCardTile({
  recipient,
  design,
  onOpen,
}: {
  recipient: Recipient;
  design: SavedDesign;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries[0]?.isIntersecting ?? false),
      // Pre-mount a little before it scrolls in, so there's no blank flash.
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const merged = useMemo(() => applyMergeTokens(design.document, recipient), [design, recipient]);
  const hint = near ? insideFacesHint(merged) : null;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className="group flex flex-col items-center gap-1.5 rounded-lg p-1 text-center transition-colors hover:bg-foreground/[0.03]"
    >
      <span className="relative" style={{ width: TILE_WIDTH, height: TILE_HEIGHT }}>
        {near ? (
          <CardFacePreview document={merged} width={TILE_WIDTH} />
        ) : (
          <span className="block size-full animate-pulse rounded-md border border-border bg-foreground/[0.04]" />
        )}
        {hint && (
          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {hint}
          </span>
        )}
      </span>
      <span className="w-[150px] truncate text-xs font-medium group-hover:text-foreground">
        {recipient.firstName} {recipient.lastName}
      </span>
      <span className="w-[150px] truncate text-[11px] text-muted">{shortAddress(recipient)}</span>
    </button>
  );
}

/**
 * Full-screen "review every card" overlay: search by name and scroll through a
 * card for every recipient in the run, each showing the name + address it posts
 * to, and opening the flip lightbox (all faces) on click. This is what lets a
 * sender actually verify a 500 / 1,000 / 10,000-card run before paying — not
 * just the first handful. See ADR 0118.
 */
export function ReviewAllCards({
  design,
  recipients,
  onClose,
}: {
  design: SavedDesign;
  recipients: Recipient[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [previewFor, setPreviewFor] = useState<Recipient | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Close the lightbox first if it's open, else the overlay.
        if (previewFor) setPreviewFor(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, previewFor]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter((r) => `${r.firstName} ${r.lastName}`.toLowerCase().includes(q));
  }, [recipients, query]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-col">
          <h2 className="font-semibold">Review every card</h2>
          <p className="text-xs text-muted">
            {filtered.length === recipients.length
              ? `${recipients.length} card${recipients.length === 1 ? "" : "s"} — click any to flip through all faces`
              : `Showing ${filtered.length} of ${recipients.length}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm sm:w-56"
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/[0.04]"
          >
            Done
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted">No contacts match “{query}”.</p>
        ) : (
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((recipient) => (
              <LazyCardTile
                key={recipient.id}
                recipient={recipient}
                design={design}
                onOpen={() => setPreviewFor(recipient)}
              />
            ))}
          </div>
        )}
      </div>

      {previewFor && (
        <CardPreviewLightbox
          document={applyMergeTokens(design.document, previewFor)}
          title={`${previewFor.firstName} ${previewFor.lastName}`}
          subtitle={[previewFor.addressLine1, previewFor.addressCity, previewFor.addressPostcode]
            .filter(Boolean)
            .join(", ")}
          onClose={() => setPreviewFor(null)}
        />
      )}
    </div>
  );
}
