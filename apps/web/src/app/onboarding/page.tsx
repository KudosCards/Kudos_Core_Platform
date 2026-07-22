"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, ApiError } from "@/lib/api";
import { readPendingCardId } from "@/lib/pending-card";

/**
 * Fallback for a user with a valid Supabase session but no Account yet —
 * e.g. they confirmed their email in a separate step from the original
 * signup form. /dashboard redirects here when GET /accounts/me returns 403.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name"));

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setSubmitting(false);
      router.push("/login");
      return;
    }

    try {
      await apiFetch("/accounts", session.access_token, {
        method: "POST",
        body: JSON.stringify({ type: "organisation", name }),
      });
    } catch (apiError) {
      setSubmitting(false);
      setError(apiError instanceof ApiError ? apiError.message : "Could not create your account");
      return;
    }

    router.push(readPendingCardId() ? "/start" : "/get-started");
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="text-center">
        <p className="text-2xl font-bold tracking-tight">Kudos Cards</p>
        <p className="text-sm text-muted">Recognition, delivered</p>
      </div>
      <div className="card flex flex-col gap-4 p-6">
        <h1 className="text-xl font-bold tracking-tight">Set up your account</h1>
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
          {error && (
            <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
              {error}
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Organisation or your name
            <input
              type="text"
              name="name"
              required
              className="rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <button type="submit" disabled={submitting} className="btn-accent">
            {submitting ? "Setting up…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
