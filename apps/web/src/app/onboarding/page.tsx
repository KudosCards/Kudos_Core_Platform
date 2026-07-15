"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, ApiError } from "@/lib/api";

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

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold">Set up your account</h1>
      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          Organisation or your name
          <input
            type="text"
            name="name"
            required
            className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-foreground px-4 py-2 text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Setting up…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
