/**
 * Image pipeline for the card→PDF engine (docs/adr/0162, Phase 1b).
 *
 * Design elements and page backgrounds reference images by URL — an uploaded
 * asset (Supabase Storage, `https://…`) or a root-relative app asset (a bundled
 * sticker, e.g. `/stickers/gift.svg`). This module fetches those bytes and
 * decodes them into something pdfkit can embed:
 *
 *  - PNG / JPEG pass through untouched (pdfkit embeds them natively, lossless).
 *  - WebP / GIF / other raster formats are transcoded to PNG via sharp.
 *  - SVG stickers are rasterised to a crisp 1024px PNG (well above 300 dpi at any
 *    card size) — robust across arbitrary SVGs, and a single raster draw path in
 *    the renderer.
 *
 * It is resilient: a missing, oversized, timed-out or undecodable asset resolves
 * to `null` (the element/background is skipped) rather than failing the whole
 * print run. Results are cached per URL, so a background reused across a run's
 * recipients is fetched and decoded once.
 */

import sharp from "sharp";
import { MAX_ARTWORK_PIXELS, MAX_DECODE_PIXELS, orientedPixelSize } from "@kudos/shared-types";
import type { ImageResolver, ResolvedImage } from "./render";

/** How SVGs are rasterised: a generous longest-edge size + a high nominal density
 * so small viewBoxes still produce a sharp bitmap. */
const SVG_RASTER_SIZE = 1024;
const SVG_RASTER_DENSITY = 384;

export interface ImageResolverOptions {
  /** Base URL used to resolve root-relative asset paths (e.g. bundled stickers).
   * Without it, root-relative assets can't be fetched and resolve to null. */
  webBaseUrl?: string;
  /**
   * Hostnames the resolver is allowed to fetch from. Design documents carry
   * customer-supplied `https://…` asset URLs, and this engine runs server-side
   * on an operator's action — so without a host allowlist a crafted design is a
   * confused-deputy SSRF vector (internal services, cloud metadata). When set
   * (production passes the storage + web origins), any URL whose host isn't
   * listed resolves to null. Leave undefined only where the fetch is already
   * trusted (e.g. tests injecting `fetchImpl` fixtures). An empty array allows
   * nothing.
   */
  allowedHosts?: string[];
  /** Injectable fetch (defaults to the global). Lets tests supply fixtures. */
  fetchImpl?: FetchLike;
  /** Reject assets larger than this many bytes (default 25 MB). */
  maxBytes?: number;
  /** Abort a fetch after this many milliseconds (default 15 s). */
  timeoutMs?: number;
  /** Optional warn sink for skipped assets. */
  onWarn?: (message: string) => void;
}

/** The slice of the Fetch API this module uses — kept minimal so a stub satisfies it. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Build an {@link ImageResolver} for the engine. Memoises per asset URL for the
 * lifetime of the resolver (i.e. per print run).
 */
export function createImageResolver(options: ImageResolverOptions = {}): ImageResolver {
  const cache = new Map<string, Promise<ResolvedImage | null>>();
  return (assetUrl: string) => {
    const cached = cache.get(assetUrl);
    if (cached) return cached;
    const pending = loadImage(assetUrl, options).catch((error: unknown) => {
      options.onWarn?.(`print image skipped (${assetUrl}): ${String(error)}`);
      return null;
    });
    cache.set(assetUrl, pending);
    return pending;
  };
}

async function loadImage(
  assetUrl: string,
  options: ImageResolverOptions,
): Promise<ResolvedImage | null> {
  const url = absoluteUrl(assetUrl, options.webBaseUrl);
  if (!url) {
    options.onWarn?.(
      `print image skipped (${assetUrl}): no web base URL for a root-relative asset`,
    );
    return null;
  }
  if (!isHostAllowed(url, options.allowedHosts)) {
    options.onWarn?.(`print image skipped (${url}): host not in the allowlist`);
    return null;
  }
  const fetched = await fetchAssetBytes(url, options);
  if (!fetched) return null;
  return decodeImage(fetched.buffer, fetched.contentType, url, options);
}

/** Resolve an asset reference to an absolute http(s) URL, or null if unfetchable. */
export function absoluteUrl(assetUrl: string, webBaseUrl?: string): string | null {
  if (/^https?:\/\//i.test(assetUrl)) return assetUrl;
  if (assetUrl.startsWith("/") && webBaseUrl) {
    try {
      return new URL(assetUrl, webBaseUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Whether `url`'s host is permitted. `undefined` allowlist = unrestricted (only
 * for already-trusted callers); any provided list (including empty) is enforced
 * by exact, case-insensitive hostname match — no subdomain widening. Exported
 * for testing.
 */
export function isHostAllowed(url: string, allowedHosts?: string[]): boolean {
  if (allowedHosts === undefined) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((allowed) => allowed.toLowerCase() === host);
}

/** The hostname of a config URL, or null if it can't be parsed. Helper for
 * building an {@link ImageResolverOptions.allowedHosts} list from env URLs. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Fetch an asset's raw bytes with the engine's size cap and timeout, or null if
 * it can't be had. Exported because an operator downloading the *original*
 * uploaded file needs exactly these protections and none of the decoding below —
 * the point of that download is bytes that were never transformed.
 */
export async function fetchAssetBytes(
  url: string,
  options: ImageResolverOptions,
): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return null;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      options.onWarn?.(`print image skipped (${url}): HTTP ${res.status}`);
      return null;
    }
    // Reject before buffering when the server declares an over-cap size, so a
    // hostile/huge asset can't be fully read into memory just to be discarded.
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      options.onWarn?.(`print image skipped (${url}): ${declared} bytes (declared) over cap`);
      return null;
    }
    // Post-check too — Content-Length can be absent (chunked) or understated.
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      options.onWarn?.(`print image skipped (${url}): ${arrayBuffer.byteLength} bytes over cap`);
      return null;
    }
    return { buffer: Buffer.from(arrayBuffer), contentType: res.headers.get("content-type") };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decode raw bytes into an embeddable raster (PNG/JPEG). Exported for testing.
 *
 * **Only JPEG is passed through untouched**, and only because pdfkit embeds the
 * DCT stream without decoding it — so malformed JPEG bytes become a bad image in
 * a PDF viewer, never our problem. Everything else is re-encoded through `sharp`,
 * which is what makes the bytes *known-decodable* before pdfkit's own PNG decoder
 * ever sees them.
 *
 * That is not tidiness. pdfkit inflates a PNG's IDAT with
 * `zlib.inflate(data, (err) => { if (err) throw err })` — a throw inside an async
 * callback, which no `try`/`catch` on this path can see and which takes the whole
 * process down. Verified: a PNG with a valid IHDR and a corrupted IDAT passes
 * `metadata()`, `doc.image()` returns without throwing, and the process then exits
 * on an uncaught `invalid bit length repeat`. Re-encoding turns that into a
 * `vipspng: libpng read error` rejection, caught below, and the asset is skipped
 * like any other unreadable one.
 */
export async function decodeImage(
  buffer: Buffer,
  contentType: string | null,
  url: string,
  options: ImageResolverOptions = {},
): Promise<ResolvedImage | null> {
  try {
    if (isSvg(buffer, contentType, url)) {
      const png = await sharp(buffer, {
        density: SVG_RASTER_DENSITY,
        limitInputPixels: MAX_DECODE_PIXELS,
      })
        .resize({ width: SVG_RASTER_SIZE, height: SVG_RASTER_SIZE, fit: "inside" })
        .png()
        .toBuffer();
      return withDimensions(png);
    }

    // Header only — no decode, no pixels. The pixel budget has to be applied off
    // the header rather than by letting the decode fail, because the decode is
    // the thing we are protecting: a 74-byte PNG can declare 256 megapixels.
    const meta = await sharp(buffer).metadata();
    // Everything below works in *display* orientation. A phone photo is stored
    // landscape with a tag saying "turn me", and the tag is the difference
    // between a portrait card and a sideways one.
    const upright = orientedPixelSize(
      { width: meta.width ?? 0, height: meta.height ?? 0 },
      meta.orientation,
    );
    const pixels = upright.width * upright.height;

    if (pixels > MAX_DECODE_PIXELS) {
      options.onWarn?.(
        `print image skipped (${url}): ${meta.width}x${meta.height} exceeds the decode limit`,
      );
      return null;
    }

    if (pixels > MAX_ARTWORK_PIXELS) {
      // More pixels than the largest card can print at 600 dpi. Downscaled, not
      // refused: an oversized upload is a real customer sending us a real photo,
      // and the right answer is to print it, not to drop it from the card.
      const scale = Math.sqrt(MAX_ARTWORK_PIXELS / pixels);
      // `.rotate()` with no argument bakes the EXIF tag into the pixels, so the
      // resize targets below are in the orientation the card will show.
      const resized = sharp(buffer, { limitInputPixels: MAX_DECODE_PIXELS })
        .rotate()
        .resize({
          width: Math.max(1, Math.floor(upright.width * scale)),
          height: Math.max(1, Math.floor(upright.height * scale)),
          fit: "fill",
        });
      // Re-encoding a JPEG is lossy, but resampling already is; at this size the
      // card cannot show the difference. PNG stays lossless.
      const out =
        meta.format === "jpeg"
          ? await resized.jpeg({ quality: 95 }).toBuffer()
          : await resized.png().toBuffer();
      options.onWarn?.(
        `print image downscaled (${url}): ${meta.width}x${meta.height} over the print ceiling`,
      );
      return withDimensions(out);
    }

    if (meta.format === "jpeg" && upright.width && upright.height && !meta.icc) {
      // The one passthrough, and the one place the bytes keep their EXIF tag —
      // which is fine, because pdfkit reads orientation from a JPEG and turns it
      // at draw time. The dimensions returned are the upright ones, so they
      // describe what actually lands on the card rather than how it is stored.
      //
      // Only for a JPEG carrying **no ICC profile**, which by convention means
      // sRGB. See `colourManagedJpeg` for the other half and why.
      return { data: buffer, width: upright.width, height: upright.height };
    }

    if (meta.format === "jpeg") {
      // A JPEG that *does* carry a profile — an Adobe RGB export out of
      // Lightroom, a Display P3 photo off a phone — cannot be passed through.
      //
      // pdfkit writes no ICC profile into the PDF at all (`COLOR_SPACE_MAP` is
      // chosen by channel count), so whatever numbers we hand it are printed as
      // device RGB. Hand it Adobe RGB numbers and the printer reads them as
      // sRGB: every saturated colour lands muted and shifted, on a ten-ink
      // pigment printer bought precisely for its colour.
      //
      // Re-encoding fixes it without any explicit colour call, because `sharp`
      // honours the input profile and its output is sRGB: a Display P3 file
      // storing green as (117, 251, 76) comes back as (3, 255, 0). `.rotate()`
      // bakes the EXIF tag into the pixels as it does on the transcode path
      // below, and sharp strips both EXIF and the profile on output, so pdfkit
      // cannot rotate a second time on top of it.
      //
      // Lossy, and knowingly: one re-encode at 95 is invisible at card size,
      // whereas the colour shift is not. A profile that happens to *be* sRGB is
      // re-encoded too rather than parsed — the transform is then a no-op and
      // the only cost is that same invisible generation.
      const out = await sharp(buffer, { limitInputPixels: MAX_DECODE_PIXELS })
        .rotate()
        .jpeg({ quality: 95 })
        .toBuffer();
      return withDimensions(out);
    }

    // PNG, WebP, GIF (first frame), TIFF, AVIF, … → a PNG we have decoded ourselves.
    //
    // `.rotate()` is load-bearing here, not tidiness. pdfkit reads EXIF only
    // from JPEG, and PNG carries no orientation tag at all — so transcoding
    // without baking the rotation in silently drops it, and a WebP phone photo
    // that shows upright in the editor prints on its side and is cover-cropped
    // on the wrong axis. The editor is not wrong: browsers apply the tag when
    // they decode WebP. See docs/card-print-quality-plan.md, D6.
    const png = await sharp(buffer, { limitInputPixels: MAX_DECODE_PIXELS })
      .rotate()
      .png()
      .toBuffer();
    return withDimensions(png);
  } catch (error) {
    options.onWarn?.(`print image undecodable (${url}): ${String(error)}`);
    return null;
  }
}

async function withDimensions(data: Buffer): Promise<ResolvedImage | null> {
  const meta = await sharp(data).metadata();
  if (!meta.width || !meta.height) return null;
  return { data, width: meta.width, height: meta.height };
}

function isSvg(buffer: Buffer, contentType: string | null, url: string): boolean {
  if (contentType && /svg/i.test(contentType)) return true;
  if (/\.svg(\?|#|$)/i.test(url)) return true;
  // Sniff: an SVG starts with "<?xml" or "<svg" (allowing leading whitespace/BOM).
  const head = buffer.subarray(0, 256).toString("utf8").trimStart();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && /<svg[\s>]/i.test(head));
}
