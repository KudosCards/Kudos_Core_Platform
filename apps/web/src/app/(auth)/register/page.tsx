"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, ApiError } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name"));
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });

    if (signUpError) {
      setSubmitting(false);
      setError(signUpError.message);
      return;
    }

    if (!data.session) {
      // Email confirmation is required before a session exists — the
      // account gets created once they confirm and log in (see the
      // onboarding flow in (app)/layout.tsx).
      setSubmitting(false);
      setCheckEmail(true);
      return;
    }

    try {
      await apiFetch("/accounts", data.session.access_token, {
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

  if (checkEmail) {
    return (
      <p className="text-foreground/70">
        Check your email to confirm your account, then{" "}
        <Link href="/login" className="underline">
          log in
        </Link>
        .
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
      <h1 className="text-2xl font-semibold">Create your account</h1>
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
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          name="email"
          required
          className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          name="password"
          required
          minLength={8}
          className="rounded-md border border-black/10 px-3 py-2 dark:border-white/10"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-full bg-foreground px-4 py-2 text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Creating your account…" : "Start free"}
      </button>
      <p className="text-sm text-foreground/70">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </form>
  );
}
