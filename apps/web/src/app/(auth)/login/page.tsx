"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { readPendingCardId } from "@/lib/pending-card";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set after a successful password reset (redirected here as ?reset=1). Read on
  // the client to avoid a Suspense boundary for useSearchParams.
  const [justReset] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("reset"),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }

    // If they came in via "Personalise this card" and confirmed their email in
    // between, finish that journey in the editor instead of the dashboard.
    router.push(readPendingCardId() ? "/start" : "/dashboard");
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
      <h1 className="text-xl font-bold tracking-tight">Log in</h1>
      {justReset && !error && (
        <p className="notice notice-success">
          Your password has been reset — log in with your new password.
        </p>
      )}
      {error && <p className="notice notice-danger">{error}</p>}
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          name="email"
          required
          className="rounded-md border border-border bg-surface px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          name="password"
          required
          className="rounded-md border border-border bg-surface px-3 py-2"
        />
      </label>
      <button type="submit" disabled={submitting} className="btn-accent">
        {submitting ? "Logging in…" : "Log in"}
      </button>
      <div className="flex flex-col gap-1 text-sm">
        <Link href="/forgot-password" className="text-accent hover:underline">
          Forgot your password?
        </Link>
        <p className="text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-accent hover:underline">
            Register
          </Link>
        </p>
      </div>
    </form>
  );
}
