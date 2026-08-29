"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "@/lib/api";

/**
 * "Forgot password" — posts the email to the public API, which emails a Supabase
 * recovery link (landing on /reset-password). The response is always success, so
 * we always show the same "check your email" confirmation and never reveal
 * whether the address has an account. See docs/adr/0051.
 */
export default function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      // Public endpoint — no auth token needed (empty bearer is ignored by the
      // @Public() route).
      await apiFetch("/auth/request-password-reset", "", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Something went wrong — please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-xl font-bold tracking-tight">Check your email</h1>
        <p className="text-sm text-muted">
          If that email has a Kudos account, we’ve sent a link to reset your password. It may take a
          minute to arrive — check your spam folder too.
        </p>
        <Link href="/login" className="mt-2 text-sm text-accent hover:underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted">
          Enter your email and we’ll send you a link to choose a new password.
        </p>
      </div>
      {error && <p className="notice notice-danger">{error}</p>}
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm"
        />
      </label>
      <button type="submit" disabled={submitting} className="btn-accent">
        {submitting ? "Sending…" : "Send reset link"}
      </button>
      <Link href="/login" className="text-center text-sm text-muted hover:text-foreground">
        Back to log in
      </Link>
    </form>
  );
}
