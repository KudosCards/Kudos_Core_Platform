import * as Sentry from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent } from "./lib/sentry-scrub";

// Server-side (Node runtime) error monitoring. A no-op unless
// NEXT_PUBLIC_SENTRY_DSN is set, so environments without a DSN are unchanged.
// This is what captures Server Component / SSR errors (e.g. a failed API fetch
// on /recipients) via the onRequestError hook in instrumentation.ts.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    // A public page that takes a secret takes it in the URL — there is no
    // session yet, so the URL is the credential. The API has scrubbed its own
    // since ADR 0187 and this side had nothing. See ADR 0228.
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}
