import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    // Keep visited pages warm in the client-side Router Cache so bouncing
    // between recently-seen pages is instant (served from cache, no server
    // round-trip). `dynamic` covers our pages — they're all dynamically
    // rendered because they read the session cookie. 30s is long enough to make
    // back-and-forth navigation feel native without serving badly stale data;
    // any mutation still calls router.refresh()/revalidatePath to bust it.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

// Wrap for Sentry (source-map upload, tunnelling). Build-safe: without a
// SENTRY_AUTH_TOKEN it skips source-map upload rather than failing, and
// `silent` suppresses the noise. Error capture itself is driven by the
// instrumentation files and is a no-op unless NEXT_PUBLIC_SENTRY_DSN is set.
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
