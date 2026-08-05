"use client";

import type { BatchOrderPreflight, Recipient, SavedDesign } from "@kudos/shared-types";
import { applyMergeTokens, CARD_HEIGHT, CARD_WIDTH } from "@kudos/shared-types";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardPreviewLightbox, insideFacesHint } from "@/components/card-preview-lightbox";
import { formatGbp } from "@/lib/orders";
import { downloadContactSheet } from "./contact-sheet";

/** The deliberate confirm step for a large run (ADR 0118): the exact total, a
 * summary of the pre-send check, and a Pay CTA gated behind an explicit "I've
 * reviewed everything" tick — so nobody pays for thousands of cards on a stray
 * click. Absent for the plain "review" open, which is just a look-through. */
export interface ReviewConfirm {
  preflight: BatchOrderPreflight | null;
  /** True while the pay request is in flight / redirecting to Stripe. */
  paying: boolean;
  onPay: () => void;
}

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
  confirm,
  postageLabel = "Standard postage",
}: {
  design: SavedDesign;
  recipients: Recipient[];
  onClose: () => void;
  /** When present, the overlay becomes the deliberate "Review & confirm" gate
   * with a pay footer; otherwise it's a plain look-through. */
  confirm?: ReviewConfirm;
  /** How the run posts, for the downloadable proof sheet header. */
  postageLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [previewFor, setPreviewFor] = useState<Recipient | null>(null);
  // The gate's "I've checked everything" acknowledgement — pay stays disabled
  // until it's ticked, so a large run is never charged on a stray click.
  const [acknowledged, setAcknowledged] = useState(false);

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
          <h2 className="font-semibold">{confirm ? "Review & confirm" : "Review every card"}</h2>
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
            onClick={() =>
              downloadContactSheet(design, recipients, {
                postageLabel,
                totalLabel: confirm?.preflight
                  ? formatGbp(confirm.preflight.price.totalMinor)
                  : undefined,
              })
            }
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/[0.04]"
            title="Download a printable list of every card, address and message"
          >
            ⬇ Proof sheet
          </button>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/[0.04]"
          >
            {confirm ? "Back" : "Done"}
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

      {confirm && (
        <ConfirmFooter
          confirm={confirm}
          cardCount={recipients.length}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
        />
      )}

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

/** The sticky pay bar for the confirm gate: pre-send-check summary, the exact
 * total, the acknowledgement tick, and the Pay CTA. */
function ConfirmFooter({
  confirm,
  cardCount,
  acknowledged,
  onAcknowledge,
}: {
  confirm: ReviewConfirm;
  cardCount: number;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
}) {
  const { preflight, paying, onPay } = confirm;
  const total = preflight?.price.totalMinor ?? null;
  const chargeCount = preflight?.price.cardCount ?? cardCount;
  const needsAttention = preflight ? preflight.total - preflight.ready : 0;
  const canPay = !!preflight && !paying && acknowledged;

  return (
    <div className="border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1.5">
          {preflight ? (
            needsAttention === 0 ? (
              <p className="text-sm font-medium text-emerald-700">
                ✓ All {preflight.total} cards ready to print, personalise and post.
              </p>
            ) : (
              <p className="text-sm">
                <span className="font-semibold text-emerald-700">{preflight.ready} ready</span>
                <span className="text-muted"> · </span>
                <span className="font-semibold text-accent">
                  {needsAttention} need{needsAttention === 1 ? "s" : ""} attention
                </span>
                <span className="text-muted"> — only ready cards are charged and sent.</span>
              </p>
            )
          ) : (
            <p className="text-sm text-muted">Running the final check…</p>
          )}
          <label className="flex items-start gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => onAcknowledge(e.target.checked)}
              className="mt-0.5 size-4 accent-accent"
            />
            <span>
              I&apos;ve reviewed the {chargeCount} card{chargeCount === 1 ? "" : "s"} and the
              addresses they post to.
            </span>
          </label>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col leading-tight">
            <span className="text-xs text-muted">
              {chargeCount} card{chargeCount === 1 ? "" : "s"} · total
            </span>
            <span className="text-lg font-semibold">
              {total === null ? "—" : formatGbp(total)}
            </span>
          </div>
          <button
            type="button"
            disabled={!canPay}
            onClick={onPay}
            className="btn-accent whitespace-nowrap disabled:opacity-50"
          >
            {paying
              ? "Taking you to payment…"
              : `Pay & send ${chargeCount} card${chargeCount === 1 ? "" : "s"} →`}
          </button>
        </div>
      </div>
    </div>
  );
}
