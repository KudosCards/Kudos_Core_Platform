/**
 * The paths the app serves to somebody with no session.
 *
 * Its own module, with no `next/server` import, so it can be tested directly —
 * every entry is the landing page of a link we emailed, and a missing one fails
 * silently: the proxy redirects to /login before the page runs, so whatever
 * that page was going to do never happens and the customer reports that the
 * email did not work rather than that a redirect happened. `/auth/confirm` was missing from the day the page
 * was written. See ADR 0267.
 */
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/admin-login",
  // Password flows: the user arrives via a Supabase email link with the session
  // in the URL fragment (not yet a cookie), so these must not bounce to /login
  // before the client can establish the session. See docs/adr/0051.
  "/forgot-password",
  "/reset-password",
  "/admin-set-password",
  // Where a signup confirmation link lands. The person clicking it has just
  // confirmed their email — Supabase's own verify endpoint does that before it
  // redirects — but has **no session yet**: the code exchange on this page is
  // what mints one. Bouncing them to /login meant the page never ran, so the
  // session was never minted, onboarding was never reached and the
  // pending-account stash was never read there. They landed on a login form
  // with no explanation, which reads as the link not working. See ADR 0267.
  "/auth/confirm",
  // Marketing and legal pages. These are linked from the public homepage and its
  // footer, so bouncing a logged-out visitor (or a crawler) to /login makes them
  // unreachable and unindexable.
  "/enterprise",
  "/faq",
  "/for",
  "/guides",
  "/terms",
  "/privacy",
];

/**
 * Whether a path may be served to somebody with no session.
 *
 * Exported for the test beside this file. Every entry here is a page somebody
 * reaches from an email, and the cost of a missing one is silent: the proxy
 * 307s to /login, the page never runs, and the customer reports that the email
 * did not work. `/auth/confirm` was missing from the day it was written.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    // Public recipient message pages (/r/<slug>).
    pathname.startsWith("/r/") ||
    // The public card library: visitors browse /cards and /cards/<id> with no
    // account, and buy a one-off card via the guest flow (/cards/<id>/send).
    // See docs/adr/0017-public-card-library.md and 0025.
    pathname === "/cards" ||
    pathname.startsWith("/cards/") ||
    // The guest basket — a one-off visitor fills it and checks out with no
    // account (POST /guest/cart-checkout). See docs/adr/0025.
    pathname === "/basket" ||
    // Guest checkout's Stripe return pages — the buyer has no session.
    pathname.startsWith("/gift/") ||
    // Team invite acceptance — an invited colleague may not have a login yet,
    // so the accept page authenticates them itself. See docs/adr/0028.
    pathname.startsWith("/invite/") ||
    // The audience pages (/for/schools, ...) — public marketing content behind
    // the homepage's "Used by" pills. See ADR 0164.
    pathname.startsWith("/for/") ||
    // The occasion guides (/guides/what-to-write-in-a-birthday-card, ...).
    pathname.startsWith("/guides/") ||
    // Returned-to-sender address recovery. ADR 0039 specifies a "public, no-login
    // recovery page" reached from the RTS email — auth *is* the token — so a
    // bounce to /login breaks the flow it exists for.
    pathname.startsWith("/rts/")
  );
}
