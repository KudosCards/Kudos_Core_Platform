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
     * robots.txt and sitemap.xml are excluded too: they're crawler-facing files
     * with no session to refresh, and without this the proxy treats them as
     * app routes and 307s them to /login — which would make the whole site look
     * uncrawlable. See docs/seo-plan.md (Phase 1).
     */
    "/((?!_next/static|_next/image|favicon.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
