import * as Sentry from "@sentry/nextjs";

/** Loads the runtime-appropriate Sentry init (Node vs Edge). Next calls this
 * once per server runtime at startup. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/** Captures errors thrown while rendering Server Components / SSR (e.g. a failed
 * API fetch on a page) — the exact class of failure behind the /recipients
 * server error. No-op unless Sentry was initialised. */
export const onRequestError = Sentry.captureRequestError;
