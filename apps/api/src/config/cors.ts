import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

/** Trim surrounding whitespace and drop a trailing slash so two spellings of
 * the same origin compare equal (`https://x.co/` === `https://x.co`). */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

/** Split a comma-separated env value into trimmed, non-empty entries. */
export function parseCommaList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * True when `origin` may call the API: an exact match against `allowed`, or it
 * ends with one of `suffixes` (for dynamic hosts like Netlify deploy previews,
 * e.g. suffix `--kudos-cards.netlify.app`).
 */
export function isOriginAllowed(
  origin: string,
  allowed: readonly string[],
  suffixes: readonly string[],
): boolean {
  const normalized = normalizeOrigin(origin);
  if (allowed.some((entry) => normalizeOrigin(entry) === normalized)) return true;
  return suffixes.some((suffix) => suffix.length > 0 && normalized.endsWith(suffix));
}

/**
 * Build the CORS `origin` option from an allow-list (+ optional suffixes).
 *
 * Requests with no `Origin` header — same-origin, server-to-server, curl — are
 * always allowed; only cross-origin *browser* requests are gated. A disallowed
 * origin is refused by omitting the `Access-Control-Allow-Origin` header
 * (callback `false`), never by throwing: one stray origin must not turn into a
 * 500. Trusting a configurable list (rather than a single value) means a wrong
 * or typo'd origin degrades gracefully instead of blacking out the whole app.
 * See docs/adr/0081-cors-allowlist-and-url-validation.md.
 */
export function corsOriginChecker(
  allowed: readonly string[],
  suffixes: readonly string[] = [],
): CorsOptions["origin"] {
  const allowList = [...new Set(allowed.map(normalizeOrigin))];
  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, isOriginAllowed(origin, allowList, suffixes));
  };
}
