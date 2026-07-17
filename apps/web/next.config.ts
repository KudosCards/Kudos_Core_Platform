import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {/* config options here */};

// Wrap for Sentry (source-map upload, tunnelling). Build-safe: without a
// SENTRY_AUTH_TOKEN it skips source-map upload rather than failing, and
// `silent` suppresses the noise. Error capture itself is driven by the
// instrumentation files and is a no-op unless NEXT_PUBLIC_SENTRY_DSN is set.
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
