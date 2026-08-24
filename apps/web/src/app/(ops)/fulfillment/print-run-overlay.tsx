"use client";

import type { CardSize, DesignDocument, DesignPage } from "@kudos/shared-types";
import {
  applyMergeTokens,
  BACK_RESERVED_FOOTER_MM,
  CARD_SIZES,
  cardSizeLabel,
  collectPrintImageTargets,
  DEFAULT_CARD_SIZE,
  fittedCardMm,
  imagePrintDpi,
  isLowPrintDpi,
  mmToCssPx,
  type PrintedSizeMm,
} from "@kudos/shared-types";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { facesOf } from "@/components/card-preview-lightbox";
import { clientApiDownload } from "@/lib/api.client";

const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

/**
 * Backing-store density for the Konva print faces. Each face is sized in CSS px
 * at the 96dpi paged-media reference (see `mmToCssPx`), so a canvas rendered at
 * the device's default ratio prints at only ~96–192dpi — visibly soft. Rendering
 * the backing store at `300 / 96` the CSS pixels lifts the rasterised face to a
 * print-grade ~300dpi. (True vector output — sharp text, full-resolution images —
 * arrives with the server-side PDF renderer; this is the drop-in raster win.)
 */
const PRINT_PIXEL_RATIO = 300 / 96;

/** Human label per face, for the (screen-only) collation caption. */
const FACE_LABEL: Record<DesignPage["name"], string> = {
  front: "Front",
  "inside-left": "Inside left",
  "inside-right": "Inside right",
  back: "Back",
};

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
  /** This card's QR slug (minted at settlement), or null. Used to render the
   * real /r/<slug> QR onto the print. */
  messagePageSlug: string | null;
}

/** Human occasion label for {occasion}: a custom title wins, else the type
 * (e.g. "birthday") title-cased. */
function occasionLabel(card: PrintRunCard): string | null {
  if (card.occasionTitle) return card.occasionTitle;
  if (!card.occasionType) return null;
  return card.occasionType.charAt(0).toUpperCase() + card.occasionType.slice(1);
}

/** One face of one card, ready to lay out on its own physical page. */
interface PrintFace {
  key: string;
  document: DesignDocument;
  face: DesignPage["name"];
  recipientName: string;
  savedDesignName: string;
  /** Absolute /r/<slug> link this card's QR encodes, or undefined if none. */
  qrUrl?: string;
}

/**
 * A print-ready sheet of an entire run's personalised card faces — **every face
 * a design has** (front, the inside message, and back), one face per physical
 * page at a true A5 or A6 size, so what the operator saves as a PDF is the exact
 * card that gets printed. The design (authored 3:4) is scaled to fit the A-page
 * without distortion and centred with a small safe margin; the same millimetre
 * page box is both the on-screen preview and the printed page, so preview =
 * print. Ops picks A5/A6 per run (defaulting to the super-admin default); the
 * choice drives an injected `@page` size. See docs/adr/0032, 0118 and 0138.
 */
/** The unique raster images across a run, each mapped to the most demanding
 * (largest) printed size it appears at — so each source is checked once against
 * its worst case. */
function mostDemandingImageTargets(cards: PrintRunCard[], size: CardSize): Map<string, PrintedSizeMm> {
  const map = new Map<string, PrintedSizeMm>();
  for (const card of cards) {
    for (const target of collectPrintImageTargets(card.document, size)) {
      const existing = map.get(target.assetUrl);
      const area = target.printed.widthMm * target.printed.heightMm;
      if (!existing || area > existing.widthMm * existing.heightMm) {
        map.set(target.assetUrl, target.printed);
      }
    }
  }
  return map;
}

/** Load an image's natural pixel size, or null if it can't be loaded (a load
 * failure shouldn't produce a false low-res warning). */
function loadNaturalSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    // No crossOrigin: we only read naturalWidth/Height, which needs no CORS, and
    // requesting it makes assets served without CORS headers fail to load —
    // which would silently suppress the low-res warning. Matches the editor path.
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function PrintRunOverlay({
  cards,
  onClose,
  defaultSize = DEFAULT_CARD_SIZE,
}: {
  cards: PrintRunCard[];
  onClose: () => void;
  defaultSize?: CardSize;
}) {
  const [size, setSize] = useState<CardSize>(defaultSize);
  // Whether the back's reserved strip hides the artwork under it (what prints)
  // or is drawn over it (what the customer supplied). Defaults to what prints;
  // "Full artwork" exists because reviewing a full-bleed back is impossible when
  // the hidden part is exactly the part in question. See ADR 0166.
  const [reservedFooter, setReservedFooter] = useState<"clip" | "reveal">("clip");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Pre-flight: how many source images are too low-resolution for print at this
  // size (null while checking). See docs/adr/0162.
  const [lowResCount, setLowResCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const targets = mostDemandingImageTargets(cards, size);
    void (async () => {
      const flags = await Promise.all(
        Array.from(targets.entries()).map(async ([url, printed]) => {
          const natural = await loadNaturalSize(url);
          return natural !== null && isLowPrintDpi(imagePrintDpi(natural, printed));
        }),
      );
      if (!cancelled) setLowResCount(flags.filter(Boolean).length);
    })();
    return () => {
      cancelled = true;
    };
  }, [cards, size]);

  // Download a true print-ready PDF rendered server-side (vector text,
  // full-resolution images, exact trim size — no bleed or crop marks, since we
  // print and fold rather than trim) — as opposed to the browser-print raster
  // path below. See docs/adr/0162.
  async function downloadPdf() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await clientApiDownload(
        "/fulfillment/print-run/pdf",
        { method: "POST", body: JSON.stringify({ jobIds: cards.map((card) => card.jobId), size }) },
        `kudos-print-run-${cards.length}-card${cards.length === 1 ? "" : "s"}-${size}.pdf`,
      );
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not generate the PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

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

  const { pageWidthMm, pageHeightMm, cardWidthMm } = fittedCardMm(size);
  // Render the Konva face at the CSS-pixel width that prints at the fitted
  // millimetre width (96dpi paged-media reference), so the canvas is physically
  // the right size on paper — not a fixed on-screen pixel size floated on A4.
  const cardWidthPx = mmToCssPx(cardWidthMm);

  // Flatten to one entry per face so we can drop the page break after the very
  // last one (a trailing break can emit a blank final page in some browsers).
  const faces: PrintFace[] = cards.flatMap((card) => {
    // Merge once per card, then print every face the design has.
    const merged = applyMergeTokens(card.document, {
      firstName: card.recipientFirstName,
      lastName: card.recipientLastName,
      occasion: occasionLabel(card),
      occasionDate: card.occasionDate,
      customFields: card.recipientCustomFields,
    });
    // The absolute link this card's QR encodes — built from its own slug the
    // same way the Messages page does, so a scanned printed card lands on /r/<slug>.
    const qrUrl =
      card.messagePageSlug && typeof window !== "undefined"
        ? `${window.location.origin}/r/${card.messagePageSlug}`
        : undefined;
    return facesOf(merged).map((face) => ({
      key: `${card.jobId}-${face}`,
      document: merged,
      face,
      recipientName: `${card.recipientFirstName} ${card.recipientLastName}`,
      savedDesignName: card.savedDesignName,
      qrUrl,
    }));
  });

  // Whether this run has a back face at all — the toggle is meaningless without
  // one, and a dead control invites a support ticket.
  const hasBack = faces.some((entry) => entry.face === "back");

  return createPortal(
    <div data-print-run className="fixed inset-0 z-[60] overflow-auto bg-white">
      {/* Physical page size for print — drives the PDF/paper page. Injected so
          it tracks the operator's A5/A6 choice; `margin: 0` lets the card's own
          fitted margin be the only whitespace. */}
      <style>{`@media print { @page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; } }`}</style>

      {/* Toolbar — screen only; never printed. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-white px-6 py-3 print:hidden">
        <span className="text-sm font-medium text-black">
          {cards.length} personalised card{cards.length === 1 ? "" : "s"} — every face, one per page
        </span>
        {downloadError && (
          <p className="order-last basis-full text-sm text-red-600" role="alert">
            {downloadError}
          </p>
        )}
        {reservedFooter === "reveal" && (
          <p className="order-last basis-full text-sm text-black/70" role="status">
            Showing the customer&apos;s full uploaded artwork. Everything below the red dashed line
            falls in the bottom {BACK_RESERVED_FOOTER_MM}mm that is already printed on the card with
            the Kudos logo and QR, so it will not be printed. The print-ready PDF is unaffected by
            this view.
          </p>
        )}
        {lowResCount !== null && lowResCount > 0 && (
          <p className="order-last basis-full text-sm text-amber-700" role="status">
            ⚠ {lowResCount} image{lowResCount === 1 ? "" : "s"} in this run{" "}
            {lowResCount === 1 ? "is" : "are"} low-resolution for {size} print (below ~200 dpi) and may
            look soft — consider a higher-resolution source.
          </p>
        )}
        <div className="flex items-center gap-3">
          {/* A5 / A6 size picker — changes the page size live so the preview is
              exactly what prints. */}
          <div
            className="flex items-center overflow-hidden rounded-full border border-black/20"
            role="group"
            aria-label="Print size"
          >
            {CARD_SIZES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSize(option)}
                aria-pressed={size === option}
                title={cardSizeLabel(option)}
                className={`px-3 py-1.5 text-sm font-medium ${
                  size === option ? "bg-black text-white" : "bg-white text-black hover:bg-black/5"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <span className="hidden text-xs text-black/50 sm:inline">{cardSizeLabel(size)}</span>
          {/* Back-artwork view. Only offered when the run actually has a back to
              look at, so it isn't a permanently inert control on a run of
              front-only cards. */}
          {hasBack && (
            <div
              className="flex items-center overflow-hidden rounded-full border border-black/20"
              role="group"
              aria-label="Back artwork view"
            >
              {(
                [
                  ["clip", "As printed"],
                  ["reveal", "Full artwork"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setReservedFooter(mode)}
                  aria-pressed={reservedFooter === mode}
                  title={
                    mode === "clip"
                      ? "Show the back exactly as it will print — the bottom 30mm is pre-printed with the Kudos logo and QR"
                      : "Show the customer's full uploaded artwork, with the reserved strip marked"
                  }
                  className={`px-3 py-1.5 text-sm font-medium ${
                    reservedFooter === mode
                      ? "bg-black text-white"
                      : "bg-white text-black hover:bg-black/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={downloading}
            title="Print-ready PDF: vector text, full-resolution images, exact trim size — ready to print and fold"
            className="rounded-full bg-black px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {downloading ? "Generating…" : "Download print-ready PDF"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={reservedFooter === "reveal"}
            title={
              reservedFooter === "reveal"
                ? "Switch back to \u201cAs printed\u201d first — browser print rasterises what is on screen, and this view deliberately shows artwork that must not be printed"
                : "Print from the browser (rasterised, no bleed or crop marks)"
            }
            className="rounded-full border border-black/20 px-4 py-1.5 text-sm text-black hover:bg-black/5 disabled:opacity-40"
          >
            Browser print
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

      <div className="mx-auto flex flex-col items-center gap-8 px-6 py-8 print:gap-0 print:p-0">
        {faces.map((entry, index) => (
          <div key={entry.key} className="flex flex-col items-center gap-2">
            <span className="text-xs text-black/60 print:hidden">
              {entry.recipientName} · {entry.savedDesignName} · {FACE_LABEL[entry.face]}
            </span>
            {/* The physical page: a true A5/A6 box (mm) that renders at real size
                on screen and maps 1:1 to the printed page. The card is centred
                inside with the fitted safe margin. */}
            <div
              style={{ width: `${pageWidthMm}mm`, height: `${pageHeightMm}mm` }}
              className={`flex items-center justify-center bg-white ${
                index < faces.length - 1 ? "break-after-page" : ""
              } border border-black/10 shadow-sm print:border-0 print:shadow-none`}
            >
              <CardFacePreview
                document={entry.document}
                width={cardWidthPx}
                face={entry.face}
                bordered={false}
                qrUrl={entry.qrUrl}
                pixelRatio={PRINT_PIXEL_RATIO}
                // The run's chosen trim, so the back's reserved footer lands on
                // the right line — 30mm is a different fraction of an A5.
                size={size}
                reservedFooter={reservedFooter}
              />
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
