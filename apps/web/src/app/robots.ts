import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/site";

/**
 * robots.txt. Two jobs, deliberately kept apart:
 *
 * - **Listed here:** paths we don't want crawled at all — the signed-in customer
 *   app, the ops surface, and the auth/admin entry points. A crawler only ever
 *   gets a redirect to /login from these, so there's nothing to fetch.
 *
 * - **NOT listed here:** pages that are genuinely public but must stay out of the
 *   index — the QR message pages (`/r/…`), guest checkout, basket, invites, RTS
 *   recovery. Those carry a per-page `robots: { index: false }` instead. A
 *   `Disallow` would stop crawlers fetching the page, which means they'd never
 *   see the noindex, and the URL could still be indexed off an inbound link with
 *   no content. Allowing the fetch is what actually keeps them out of the index.
 *
 * See docs/seo-plan.md (Phase 1).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Signed-in customer app — apps/web/src/app/(app).
          "/approvals",
          "/batch-orders",
          "/billing",
          "/calendar",
          "/dashboard",
          "/designs",
          "/get-started",
          "/integrations",
          "/message-pages",
          "/messages",
          "/orders",
          "/recipients",
          "/segments",
          "/send",
          "/settings",
          "/start",
          "/support",
          "/team",
          "/wallet",
          // Internal ops surface — apps/web/src/app/(ops).
          "/admin",
          "/catalog",
          "/fulfillment",
          "/storage",
          // Auth plumbing and onboarding.
          "/admin-login",
          "/admin-set-password",
          "/auth/",
          "/onboarding",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
