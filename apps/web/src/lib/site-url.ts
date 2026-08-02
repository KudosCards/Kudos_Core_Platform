import { env } from "./env";

/**
 * The canonical public origin to use when building auth-email redirect links
 * (e.g. the signup confirmation link). Prefers the configured
 * `NEXT_PUBLIC_SITE_URL` so the redirect is deterministic — a customer who
 * registers from a preview/mirror still gets sent to the real domain — and
 * falls back to the current browser origin when it isn't set. Trailing slash
 * stripped so callers can safely append a path. See ADR 0080.
 */
export function getSiteUrl(): string {
  const configured = env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
