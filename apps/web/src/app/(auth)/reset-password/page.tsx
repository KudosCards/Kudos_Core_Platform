"use client";

import Link from "next/link";
import { SetPasswordForm } from "@/components/set-password-form";

/**
 * Landing page for the Supabase recovery link sent by "forgot password". The
 * link establishes a session in the URL fragment; SetPasswordForm waits for it,
 * then updates the password. On success we send the user to /login to sign in
 * with their new password. See docs/adr/0051.
 */
export default function ResetPasswordPage() {
  return (
    <SetPasswordForm
      heading="Choose a new password"
      intro="Set a new password for your Kudos Cards account."
      submitLabel="Save new password"
      busyLabel="Saving…"
      onSuccess={() => {
        // Full navigation so the app shell re-reads the refreshed session cookie.
        window.location.assign("/login?reset=1");
      }}
      invalidLinkHelp={
        <>
          This password reset link has expired or already been used.{" "}
          <Link href="/forgot-password" className="text-accent hover:underline">
            Request a new one
          </Link>
          .
        </>
      }
    />
  );
}
