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
     */
    "/((?!_next/static|_next/image|favicon.ico|robots\\.txt|sitemap\\.xml|opengraph-image|twitter-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
