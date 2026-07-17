"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Error boundary for the authenticated app. A transient failure (e.g. the API
 * momentarily unreachable) now shows a friendly in-shell retry instead of
 * Next's bare full-page "server error" screen, and reports the error to Sentry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-foreground/60">
        We couldn&apos;t load this page. This is usually temporary — try again in a moment.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-full bg-foreground px-5 py-2 text-sm text-background hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
