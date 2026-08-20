import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

export function proxy(request: NextRequest) {
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
