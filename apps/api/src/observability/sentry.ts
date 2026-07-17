import * as Sentry from "@sentry/node";

/**
 * Initialises Sentry error monitoring if SENTRY_DSN is set. A no-op otherwise,
 * so local/dev/test and any environment without a DSN behave exactly as before.
 * MUST be called before the Nest app is created (main.ts) so Sentry's automatic
 * instrumentation wraps everything. See docs/adr — reserved slot in env.schema.ts.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Errors only by default — no performance tracing overhead until we opt in.
    tracesSampleRate: 0,
  });
}

export { Sentry };
