"use client";

import { useEffect } from "react";

/**
 * The one error screen, used by every route group's boundary.
 *
 * `serverApiFetch` throws on any non-2xx, so an API 5xx while a page loads is a
 * render error rather than an empty state. Only the authenticated app had a
 * boundary, so an operator hitting a 5xx on /fulfillment — or a visitor on a
 * marketing page — landed on Next's bare default screen, with no branding, no
 * retry, and nothing reported. See ADR 0206.
 *
 * Sentry is imported dynamically so its SDK stays out of the bundle every page
 * loads; it is fetched only if this actually renders, where the extra
 * round-trip is irrelevant. Matches instrumentation-client.ts.
 */
export function ErrorScreen({
  error,
  reset,
  title,
  message,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
  message: string;
}) {
  useEffect(() => {
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      <p className="max-w-md text-sm text-muted">{message}</p>
      <button type="button" onClick={() => reset()} className="btn-accent">
        Try again
      </button>
      {/* The digest is the only handle support has on a specific failure — it
          is what ties a customer's screenshot to a Sentry event. */}
      {error.digest && <p className="text-xs text-muted">Reference: {error.digest}</p>}
    </div>
  );
}
