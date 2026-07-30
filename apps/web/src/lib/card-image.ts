import { env } from "./env";

/**
 * next/image only optimizes URLs whose host is whitelisted in
 * `next.config.ts` `images.remotePatterns` — which is our Supabase public
 * storage bucket, and nothing else. A `thumbnailUrl` pointing anywhere else
 * (the `placehold.co` placeholders used for cards/seeds with no artwork, or any
 * future/legacy host) would make next/image THROW at render and crash the whole
 * page. So optimize only the URLs we know are whitelisted, and render everything
 * else `unoptimized` (bypassing host validation entirely). See ADR 0045.
 */
const SUPABASE_PUBLIC_PREFIX = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;

/** True when `src` is one of our Supabase public-storage URLs, i.e. safe to hand
 * to the Next image optimizer. Everything else must render `unoptimized`. */
export function isOptimizableThumbnail(src: string): boolean {
  return src.startsWith(SUPABASE_PUBLIC_PREFIX);
}

/**
 * A neutral, card-shaped (2:3) placeholder for `next/image`'s `placeholder="blur"`.
 * Card art loads over the network from Supabase Storage; without a placeholder the
 * thumbnail area is blank until it arrives, then pops in. This soft grey fills the
 * box immediately and the real image fades over it — steadier perceived load on the
 * catalog/designs grids and the product-page hero. A single tiny inlined SVG (no
 * per-image work), so it costs nothing. See ADR 0045.
 */
export const CARD_BLUR_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMiIgaGVpZ2h0PSIxOCI+PHJlY3Qgd2lkdGg9IjEyIiBoZWlnaHQ9IjE4IiBmaWxsPSIjZTZlYWYwIi8+PC9zdmc+";
