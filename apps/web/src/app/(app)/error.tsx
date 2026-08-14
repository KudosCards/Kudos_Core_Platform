"use client";

import { useEffect } from "react";

/**
 * Error boundary for the authenticated app. A transient failure (e.g. the API
 * momentarily unreachable) now shows a friendly in-shell retry instead of
 * Next's bare full-page "server error" screen, and reports the error to Sentry.
 *
 * Sentry is imported dynamically so its SDK stays out of the app-shell bundle
 * that loads on every authenticated page — it's fetched only if this boundary
 * actually renders (i.e. an error occurred), where the extra round-trip is
 * irrelevant. Matches the lazy-load approach in instrumentation-client.ts.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-xl font-bold tracking-tight">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted">
        We couldn&apos;t load this page. This is usually temporary — try again in a moment.
      </p>
      <button type="button" onClick={() => reset()} className="btn-accent">
        Try again
      </button>
    </div>
  );
}
