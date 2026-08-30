"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Error boundary for the authenticated app. See ADR 0206. */
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorScreen
      {...props}
      title="Something went wrong"
      message="We couldn’t load this page. This is usually temporary — try again in a moment."
    />
  );
}
