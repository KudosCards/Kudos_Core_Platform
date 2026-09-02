import { redactUrl, REDACTED } from "@kudos/shared-types";

/**
 * API routes whose URL *path* carries a bearer-equivalent secret.
 *
 * pino-http logs `url` on every request at `info`, which is the production
 * level, so without this the token is written to the log in full. Anyone who can
 * read logs — a host log viewer, a log-shipping vendor, an on-call engineer, or
 * an attacker who obtains them — can replay it. For `/invites/<token>/accept`
 * that means joining a customer's organisation as `admin`, indistinguishable in
 * the audit trail from the real invitee. See ADR 0187.
 *
 * Listed as prefixes rather than matched by shape: a token has no distinguishing
 * format, and guessing which path segments are secret is how one gets missed.
 *
 * These are the *API's* routes. The web app reaches the same features on
 * different paths (`/invite/<token>` for this one) and keeps its own list —
 * see apps/web/src/lib/sentry-scrub.ts and ADR 0228.
 */
const TOKEN_BEARING_PREFIXES = ["/rts/", "/invites/", "/guest/claim/"] as const;

export { REDACTED };

/**
 * Replace the token segment of a URL with a placeholder, leaving the route shape
 * intact so the logs still say which endpoint was hit.
 *
 *   /invites/pQ7abc/accept        → /invites/[redacted]/accept
 *   /rts/tok123/address?x=1       → /rts/[redacted]/address?x=1
 *   /guest/claim/tok123           → /guest/claim/[redacted]
 *
 * Anything else is returned unchanged. The mechanism is shared with the web app
 * so a scrubber improved on one side is improved on both; this file supplies
 * the routes.
 */
export function redactUrlTokens(url: string): string {
  return redactUrl(url, TOKEN_BEARING_PREFIXES);
}
