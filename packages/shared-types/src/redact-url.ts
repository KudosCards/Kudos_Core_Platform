/**
 * Stripping bearer-equivalent secrets out of a URL before it is written down.
 *
 * Both halves of the product record URLs somewhere a second set of people can
 * read them: the API logs every request at `info` and reports errors to Sentry
 * (ADR 0187), and the web reports errors and navigation breadcrumbs to the same
 * Sentry. A public page that takes a secret takes it in the URL — there is no
 * session yet, so the URL *is* the credential.
 *
 * The mechanism lives here, and each side supplies its own path prefixes,
 * because the routes genuinely differ: the API's `/invites/<token>/accept` is
 * the web's `/invite/<token>`. The algorithm does not differ, and keeping one
 * copy of it is the point — a scrubber that exists twice is a scrubber that
 * will be improved once. See ADR 0228.
 */

export const REDACTED = "[redacted]";

/**
 * Query and fragment parameters whose *value* is a credential, wherever they
 * appear. Matched by name rather than by shape: a token has no distinguishing
 * format, and guessing which values are secret is how one gets missed.
 *
 * `token_hash`, `code`, `access_token` and `refresh_token` are Supabase's
 * one-time link and implicit-flow parameters — the most valuable of the lot,
 * since each one is exchangeable for a session — and `code` is also the OAuth
 * authorization code on the CRM callbacks.
 */
export const TOKEN_PARAMS = [
  "token",
  "token_hash",
  "code",
  "access_token",
  "refresh_token",
] as const;

/**
 * Replace the values of any token-bearing parameters in an `a=b&c=d` string.
 *
 * Rewritten by hand rather than through `URLSearchParams`, which re-encodes
 * everything it serialises — it turns the placeholder into `%5Bredacted%5D` and
 * quietly rewrites every *other* parameter in the URL too. A scrubber should
 * change exactly what it was asked to change.
 */
function redactParams(query: string): string {
  return query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const name = pair.slice(0, eq);
      return (TOKEN_PARAMS as readonly string[]).includes(name) ? `${name}=${REDACTED}` : pair;
    })
    .join("&");
}

/** Replace the token segment that follows one of `pathPrefixes`. */
function redactPath(path: string, pathPrefixes: readonly string[]): string {
  for (const prefix of pathPrefixes) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest.length === 0) return path;
    // The token runs to the next path separator.
    const end = rest.indexOf("/");
    const tail = end === -1 ? "" : rest.slice(end);
    return `${prefix}${REDACTED}${tail}`;
  }
  return path;
}

/** `https://host:port` at the front of an absolute URL, if there is one. */
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/**
 * Redact a URL's token-bearing path segment, query values and fragment values,
 * leaving the route shape intact so the record still says which page was hit.
 *
 *   /invite/pQ7abc               → /invite/[redacted]
 *   /gift/claim?token=tok123     → /gift/claim?token=[redacted]
 *   /auth/confirm#access_token=a → /auth/confirm#access_token=[redacted]
 *
 * Takes absolute or relative URLs. Anything that is not one — a message, a
 * label, whatever else ends up on a breadcrumb — is returned untouched.
 *
 * Deliberately string surgery rather than `new URL`. Given a base to resolve
 * against, `new URL` accepts almost any string and hands back something
 * plausible, so "not a url at all" comes out as `/not%20a%20url%20at%20all` —
 * a scrubber that mangles what it does not recognise is worse than one that
 * passes it through.
 */
export function redactUrl(url: string, pathPrefixes: readonly string[]): string {
  const origin = ORIGIN.exec(url)?.[0] ?? "";
  const rest = url.slice(origin.length);
  // Everything this handles is rooted. If what is left is not, it is not a URL.
  if (!rest.startsWith("/")) {
    return url;
  }
  const hashAt = rest.indexOf("#");
  const beforeHash = hashAt === -1 ? rest : rest.slice(0, hashAt);
  // Supabase's implicit flow returns the session in the fragment, and a browser
  // reports `location.href` with the hash attached.
  const hash = hashAt === -1 ? "" : `#${redactParams(rest.slice(hashAt + 1))}`;

  const queryAt = beforeHash.indexOf("?");
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? "" : `?${redactParams(beforeHash.slice(queryAt + 1))}`;

  return `${origin}${redactPath(path, pathPrefixes)}${query}${hash}`;
}
