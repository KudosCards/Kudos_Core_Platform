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
import type { ImageResolver, ResolvedImage } from "./render";

/** How SVGs are rasterised: a generous longest-edge size + a high nominal density
 * so small viewBoxes still produce a sharp bitmap. */
const SVG_RASTER_SIZE = 1024;
const SVG_RASTER_DENSITY = 384;

export interface ImageResolverOptions {
  /** Base URL used to resolve root-relative asset paths (e.g. bundled stickers).
   * Without it, root-relative assets can't be fetched and resolve to null. */
  webBaseUrl?: string;
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

async function loadImage(assetUrl: string, options: ImageResolverOptions): Promise<ResolvedImage | null> {
  const url = absoluteUrl(assetUrl, options.webBaseUrl);
  if (!url) {
    options.onWarn?.(`print image skipped (${assetUrl}): no web base URL for a root-relative asset`);
    return null;
  }
  const fetched = await fetchBytes(url, options);
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

async function fetchBytes(
  url: string,
  options: ImageResolverOptions,
): Promise<{ buffer: Buffer; contentType: string | null } | null> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch);
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

/** Decode raw bytes into an embeddable raster (PNG/JPEG). Exported for testing. */
export async function decodeImage(
  buffer: Buffer,
  contentType: string | null,
  url: string,
  options: ImageResolverOptions = {},
): Promise<ResolvedImage | null> {
  try {
    if (isSvg(buffer, contentType, url)) {
      const png = await sharp(buffer, { density: SVG_RASTER_DENSITY })
        .resize({ width: SVG_RASTER_SIZE, height: SVG_RASTER_SIZE, fit: "inside" })
        .png()
        .toBuffer();
      return withDimensions(png);
    }

    const meta = await sharp(buffer).metadata();
    if (meta.format === "png" || meta.format === "jpeg") {
      if (!meta.width || !meta.height) return withDimensions(buffer);
      return { data: buffer, width: meta.width, height: meta.height };
    }
    // WebP, GIF (first frame), TIFF, AVIF, … → PNG for pdfkit.
    const png = await sharp(buffer).png().toBuffer();
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
