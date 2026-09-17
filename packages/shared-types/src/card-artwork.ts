/**
 * Whether a piece of artwork can be the front of a card, as one pure rule.
 *
 * A background *is* the card: drawn full-bleed and centre-cropped by every
 * renderer, so its shape decides what survives and its pixel count decides how
 * sharp it looks. Until now every check on it was advisory — the editor's crop
 * note, the DPI note, the ops pre-flight banner — and a wrong-shaped or soft
 * background could be saved, ordered, snapshotted onto the order line and
 * printed, with the first chance to stop it being an operator reading a warning
 * on the print run.
 *
 * This is the definition both halves of the gate share: the browser refuses
 * before a byte is uploaded, and the API refuses at the save so the browser
 * cannot be bypassed. One rule, so the two can never disagree about what is
 * acceptable — the same reason `printDpiVerdict` and `cropVerdict` are pure, and
 * this reuses both rather than inventing thresholds of its own.
 *
 * See docs/card-print-quality-plan.md, D5.
 */

import { isCatalogArtwork, type DesignDocument } from "./card";
import { DEFAULT_CARD_SIZE, type CardSize } from "./card-format";
import {
  backgroundCropLoss,
  cropLossPerEdgeMm,
  cropLossPercent,
  cropVerdict,
  croppedAxis,
  idealArtworkPixels,
} from "./card-crop";
import {
  backgroundPrintedSizeMm,
  imagePrintDpi,
  MAX_DECODE_PIXELS,
  PRINT_DPI_WARN_BELOW,
  printDpiVerdict,
  type PixelSize,
} from "./print-quality";

/** Why a background was refused. The message is what a person reads; the reason
 *  is what a caller branches on. */
export type ArtworkRefusalReason = "shape" | "resolution" | "too-many-pixels";

export interface ArtworkRefusal {
  reason: ArtworkRefusalReason;
  message: string;
}

/** "1240 × 1748 pixels (A6 at 300 dpi)" — the one number to give anyone
 *  producing artwork, and the answer to every refusal below. */
export function artworkTargetLabel(size: CardSize = DEFAULT_CARD_SIZE): string {
  const { width, height } = idealArtworkPixels(size);
  return `${width} × ${height} pixels (${size} at 300 dpi)`;
}

/**
 * Whether this artwork may be a card's background, or the reason it may not.
 *
 * `null` means acceptable. Every refusal names the same fix, because one export
 * size satisfies all three rules — which is what makes refusing reasonable
 * rather than merely obstructive.
 *
 * Judged at the given card size, defaulting to the house size. An unmeasurable
 * image returns `null`: "we could not read it" is not "it is wrong", and the
 * renderer already skips what it cannot decode.
 */
export function backgroundArtworkVerdict(
  natural: PixelSize,
  size: CardSize = DEFAULT_CARD_SIZE,
): ArtworkRefusal | null {
  if (!(natural.width > 0) || !(natural.height > 0)) return null;

  const dimensions = `${natural.width} × ${natural.height} pixels`;
  const target = artworkTargetLabel(size);
  const pixels = natural.width * natural.height;

  if (pixels > MAX_DECODE_PIXELS) {
    return {
      reason: "too-many-pixels",
      message:
        `This image is ${dimensions} — more than we can process. ` +
        `Export it at ${target} and upload that.`,
    };
  }

  const loss = backgroundCropLoss(natural);
  if (cropVerdict(loss) !== "ok") {
    const axis = croppedAxis(loss);
    const edges = axis === "width" ? "side" : "of the top and bottom";
    return {
      reason: "shape",
      message:
        `This image is ${dimensions}, which is not the card's shape: ` +
        `${cropLossPercent(loss)}% of its ${axis} would be cut off to fill the card — ` +
        `about ${cropLossPerEdgeMm(loss, size).toFixed(1)}mm off each ${edges}. ` +
        `Export it at ${target} and upload that.`,
    };
  }

  const dpi = imagePrintDpi(natural, backgroundPrintedSizeMm(size));
  if (printDpiVerdict(dpi) === "low") {
    return {
      reason: "resolution",
      message:
        `This image is ${dimensions}, which is too few to print sharply across a ` +
        `whole card — about ${Math.round(dpi)} dots per inch, against the ` +
        `${PRINT_DPI_WARN_BELOW} we need. Export it at ${target} and upload that.`,
    };
  }

  return null;
}

/**
 * The background URLs in a document that this gate is entitled to judge.
 *
 * Two exclusions, both deliberate:
 *
 * **A background the design already carried is left alone.** It was accepted
 * once, and refusing it on a later save would trap a customer in a design they
 * can neither fix nor keep — they would be unable to correct a typo on a card
 * whose artwork we changed our minds about.
 *
 * **Catalog artwork is skipped.** It is gated at the sync, where it is ours and
 * a person can go and fix it; and until the re-export lands most of it would
 * fail here, which would stop a customer saving a text edit on artwork that is
 * not theirs to change.
 */
export function judgeableBackgroundUrls(
  document: DesignDocument,
  previous?: DesignDocument | null,
): string[] {
  const alreadyThere = new Set(backgroundUrlsOf(previous));
  return backgroundUrlsOf(document).filter(
    (url) => !alreadyThere.has(url) && !isCatalogArtwork(url),
  );
}

/** Every image-background URL in a document, deduplicated. */
function backgroundUrlsOf(document?: DesignDocument | null): string[] {
  if (!document?.pages) return [];
  const urls = new Set<string>();
  for (const page of document.pages) {
    if (page.background?.type === "image") urls.add(page.background.assetUrl);
  }
  return [...urls];
}
