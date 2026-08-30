/**
 * Content-Security-Policy for the public recipient message page (`/r/<slug>`).
 *
 * This is the only page in the product that renders HTML an account member
 * wrote, to an audience of strangers, on an unauthenticated URL. The message
 * body is sanitised on the way in *and* on the way out (ADR 0181) — this is the
 * layer that assumes both of those failed. `script-src` carries no
 * `'unsafe-inline'`, so an injected `<script>` or `onerror=` handler does not
 * run even if it reaches the document.
 *
 * Deliberately scoped to `/r/` rather than applied app-wide. The designer, the
 * Stripe redirects and the ops screens each have their own script and frame
 * needs, and a policy loose enough for all of them would not be worth having
 * here. Widening it is a separate exercise with its own testing.
 */

/** Video providers the message page may embed (ADR 0132's allowlist). */
const EMBED_HOSTS = [
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://www.loom.com",
  "https://drive.google.com",
];

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export function messagePageCsp(nonce: string): string {
  // The page fetches its own content from the API, and Sentry (when configured)
  // posts errors to its ingest host. Both are same-document `connect-src`.
  const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL);
  const sentryOrigin = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN);
  const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);

  const connect = ["'self'", apiOrigin, sentryOrigin].filter(Boolean).join(" ");
  // Uploaded videos and card artwork live in Supabase Storage.
  const media = ["'self'", supabaseOrigin, "blob:"].filter(Boolean).join(" ");
  const img = ["'self'", supabaseOrigin, "data:", "blob:"].filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    // The point of the whole file: no 'unsafe-inline'. Next tags its own
    // hydration scripts with this nonce; nothing else executes.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Styles are a different matter: Tailwind and Next both emit inline style
    // attributes, and inline CSS cannot execute script. Keeping this permissive
    // is what lets script-src stay strict.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img}`,
    `media-src ${media}`,
    "font-src 'self' data:",
    `connect-src ${connect}`,
    `frame-src ${EMBED_HOSTS.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
