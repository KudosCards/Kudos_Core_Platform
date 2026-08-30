/**
 * Routes whose URL *path* carries a bearer-equivalent secret.
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
 */
const TOKEN_BEARING_PREFIXES = ["/rts/", "/invites/", "/guest/claim/"] as const;

export const REDACTED = "[redacted]";

/**
 * Replace the token segment of a URL with a placeholder, leaving the route shape
 * intact so the logs still say which endpoint was hit.
 *
 *   /invites/pQ7abc/accept        → /invites/[redacted]/accept
 *   /rts/tok123/address?x=1       → /rts/[redacted]/address?x=1
 *   /guest/claim/tok123           → /guest/claim/[redacted]
 *
 * Anything else is returned unchanged.
 */
export function redactUrlTokens(url: string): string {
  for (const prefix of TOKEN_BEARING_PREFIXES) {
    if (!url.startsWith(prefix)) continue;
    const rest = url.slice(prefix.length);
    if (rest.length === 0) return url;
    // The token runs to the next path separator, or to the query string.
    const end = rest.search(/[/?]/);
    const tail = end === -1 ? "" : rest.slice(end);
    return `${prefix}${REDACTED}${tail}`;
  }
  return url;
}
