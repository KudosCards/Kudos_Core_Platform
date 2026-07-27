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
