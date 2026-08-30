"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * Error boundary for the ops area. Worded for the print/post team rather than a
 * customer: they need to know the queue is unreadable right now, not that
 * "something went wrong", because the next thing they do is decide whether to
 * keep working from the last screen or wait. See ADR 0206.
 */
export default function OpsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorScreen
      {...props}
      title="Couldn’t load the queue"
      message="The API didn’t answer. Nothing has been changed — try again, and if it keeps failing check the API before working from a stale screen."
    />
  );
}
