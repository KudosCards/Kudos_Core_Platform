"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Error boundary for sign-in and sign-up. See ADR 0206. */
export default function AuthError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      {...props}
      title="Couldn’t load that page"
      message="Something went wrong signing you in. Your account is fine — try again in a moment."
    />
  );
}
