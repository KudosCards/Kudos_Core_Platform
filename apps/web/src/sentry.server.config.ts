import * as Sentry from "@sentry/nextjs";

// Server-side (Node runtime) error monitoring. A no-op unless
// NEXT_PUBLIC_SENTRY_DSN is set, so environments without a DSN are unchanged.
// This is what captures Server Component / SSR errors (e.g. a failed API fetch
// on /recipients) via the onRequestError hook in instrumentation.ts.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
  });
}
