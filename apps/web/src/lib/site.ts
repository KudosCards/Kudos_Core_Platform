import { env } from "./env";

/**
 * The canonical public origin of the marketing site, used for `metadataBase`,
 * canonical URLs, `robots.txt` and the sitemap.
 *
 * Reads `NEXT_PUBLIC_SITE_URL` when it's set (Netlify) and otherwise falls back
 * to the live apex domain, so a missing env var can never emit relative
 * canonicals or a sitemap full of `localhost` URLs — a wrong-but-absolute URL is
 * recoverable, a build full of preview-host canonicals is not.
 *
 * Apex rather than `www`: `netlify.toml` already 301s the `netlify.app` mirror
 * here, and the API's `WEB_APP_URL` / CORS allow-list is built around it.
 * See docs/seo-plan.md (Phase 0).
 */
export const SITE_URL = (env.NEXT_PUBLIC_SITE_URL ?? "https://kudos-cards.co.uk").replace(
  /\/+$/,
  "",
);

/** Absolute URL for a site-relative path — `"/cards"` → `"https://…/cards"`. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Metadata for pages that are public but must never be indexed: the QR message
 * pages, guest checkout and its return pages, the basket, invite and RTS token
 * pages. Spread into a page's `metadata` (`...NO_INDEX`).
 *
 * These are deliberately *not* disallowed in robots.txt — a crawler has to be
 * able to fetch the page to see this directive. See app/robots.ts.
 */
export const NO_INDEX = {
  robots: { index: false, follow: false },
} as const;
