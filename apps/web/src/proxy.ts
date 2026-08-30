import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";
import { messagePageCsp } from "./lib/message-page-csp";

/**
 * Serve `/r/<slug>` with a per-request nonce. Next reads the nonce out of the
 * `Content-Security-Policy` *request* header and stamps it onto the script tags
 * it emits, which is why the header goes on both the request and the response.
 *
 * The session refresh is skipped here on purpose: `/r/` is listed as a public
 * path, and its visitor is by construction an anonymous person who scanned a
 * printed card. There is no session to keep warm.
 */
function serveMessagePageWithCsp(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = messagePageCsp(nonce);

  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  // A message page is addressed to one named person; never let it be framed.
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function proxy(request: NextRequest) {
  // The public recipient page renders an author-written message as HTML to an
  // anonymous audience, so it gets a nonce-based CSP with no inline script
  // allowed. Scoped to this one route — see lib/message-page-csp.ts. ADR 0181.
  if (request.nextUrl.pathname.startsWith("/r/")) {
    return serveMessagePageWithCsp(request);
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static assets and image
     * optimization files, so the Supabase session cookie stays fresh on
     * every navigation without re-running on every asset request.
     *
     * robots.txt, sitemap.xml and the generated opengraph-image are excluded
     * too: they're crawler-facing with no session to refresh, and without this
     * the proxy treats them as app routes and 307s them to /login — which would
     * make the site look uncrawlable and leave every shared link without a
     * preview image. Note opengraph-image is a *route*, not a file, so the
     * extension rule below doesn't cover it. See docs/seo-plan.md (Phases 1-2).
     *
     * Route handlers under `api/` are excluded for the same reason, and it's
     * the same trap: they're called by machines with no cookie to refresh, and
     * the 307 to /login is silent — the caller gets a 200 and an HTML login
     * page rather than an error, so it looks like it worked. The catalog
     * publish endpoint hit exactly that. Excluding the prefix rather than the
     * one path means the next such route doesn't have to rediscover it.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|robots\\.txt|sitemap\\.xml|opengraph-image|twitter-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
