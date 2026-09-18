import type { Logger } from "@nestjs/common";
import sharp from "sharp";
import { MAX_DECODE_PIXELS, orientedPixelSize, type PixelSize } from "@kudos/shared-types";
import { fetchAssetBytes, isHostAllowed } from "../print-pdf";

/**
 * How big a stored asset actually is, measured from the bytes rather than taken
 * on trust.
 *
 * Two surfaces need this and they must not disagree: the artwork gate, which
 * refuses a background that would print badly, and the uploads library, whose
 * stored dimensions decide what the editor and the gate believe about a file.
 * A second copy of this would be a second answer to "how big is it", and the
 * orientation correction below is exactly the kind of thing one copy would get
 * and the other would miss.
 *
 * Always fails soft. Every caller here is doing something else that must still
 * succeed — saving a design, recording an upload — and a storage blip is not a
 * reason to fail either.
 */

/** Refuse to pull an object larger than any card could use. */
export const MEASURE_MAX_BYTES = 30 * 1024 * 1024;
/** Long enough for a real photo off Supabase, short enough not to hold a request. */
export const MEASURE_TIMEOUT_MS = 8_000;

export interface MeasureAssetOptions {
  /** Hosts the fetch is allowed to reach. A design document carries
   *  customer-supplied URLs, so this is the confused-deputy SSRF guard. */
  allowedHosts: string[];
  /** Prefix for the warnings, so a log line says which surface asked. */
  label: string;
  logger: Logger;
}

/**
 * The asset's size **in display orientation**, or null if it cannot be measured.
 *
 * Null means "we do not know", never "it is fine" — callers decide what to do
 * with not knowing, and every one of them currently proceeds.
 */
export async function measureAsset(
  url: string,
  { allowedHosts, label, logger }: MeasureAssetOptions,
): Promise<PixelSize | null> {
  if (!isHostAllowed(url, allowedHosts)) {
    // Not our storage, so not ours to fetch — the print engine will not reach it
    // either, and an unrestricted server-side fetch here is the SSRF.
    return null;
  }
  try {
    const fetched = await fetchAssetBytes(url, {
      maxBytes: MEASURE_MAX_BYTES,
      timeoutMs: MEASURE_TIMEOUT_MS,
      onWarn: (message) => logger.warn(`${label}: ${message}`),
    });
    if (!fetched) return null;

    // Header only — no decode. `limitInputPixels` still matters: it makes a
    // header declaring an absurd size fail here rather than somewhere later.
    const meta = await sharp(fetched.buffer, { limitInputPixels: MAX_DECODE_PIXELS }).metadata();
    if (!meta.width || !meta.height) return null;

    // The same correction the renderer applies. Measuring the stored size would
    // call a correctly-shaped phone photo heavily cropped — see ADR 0247.
    return orientedPixelSize({ width: meta.width, height: meta.height }, meta.orientation);
  } catch (error) {
    logger.warn(`${label}: could not measure ${url}: ${String(error)}`);
    return null;
  }
}
