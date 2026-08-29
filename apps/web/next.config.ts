import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Card artwork (thumbnails) lives in a public Supabase Storage bucket. Allow the
// Next image optimizer to fetch + resize it by whitelisting that host; falls back
// to a Supabase wildcard if the env var isn't present at build (so a build never
// breaks over image config). Scoped to public storage objects only.
// See docs/adr/0045-image-optimization.md.
const supabaseImageHostname = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "*.supabase.co";
  }
})();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseImageHostname,
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    // `dynamic: 0` — a dynamically rendered page is never served from a stale
    // client Router Cache.
    //
    // This was 30 seconds, on a written assumption that "any mutation still
    // calls router.refresh()/revalidatePath to bust it". That assumption was
    // never true: of 61 client components that mutate through the API, 16
    // called router.refresh() and 45 did not. The cache was therefore free to
    // hold a contact list, an approvals queue or a calendar from before an edit
    // that had already been saved.
    //
    // Every page here reads the session cookie, so `dynamic` covers all of
    // them — which is precisely why the risk was general rather than niche.
    // These screens describe real people, real dates and real money; a page
    // that is a few hundred milliseconds slower to return to is a far better
    // trade than one that quietly shows yesterday's answer. `static` keeps its
    // window: those pages have no per-user data to go stale.
    staleTimes: { dynamic: 0, static: 180 },
  },
};

// Wrap for Sentry (source-map upload, tunnelling). Build-safe: without a
// SENTRY_AUTH_TOKEN it skips source-map upload rather than failing, and
// `silent` suppresses the noise. Error capture itself is driven by the
// instrumentation files and is a no-op unless NEXT_PUBLIC_SENTRY_DSN is set.
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Shrink the Sentry client bundle: we don't use Session Replay (never added
  // the integration) or debug logging, so strip those code paths from the SDK
  // that ships on every page. Error capture is unaffected.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },
});
