"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * Error boundary for everything not inside its own route group's boundary — the
 * marketing pages, the legal pages, the basket, the public card library. See
 * ADR 0206.
 */
export default function PublicError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      {...props}
      title="Something went wrong"
      message="This page didn’t load. It’s usually temporary — try again in a moment."
    />
  );
}
