"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, ApiError } from "@/lib/api";
import { readPendingCardId, setPendingCardId } from "@/lib/pending-card";
import { setPendingPlan } from "@/lib/pending-plan";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  // Personal = an individual tracking their own friends'/family birthdays;
  // organisation = a business/centre/club. Drives the onboarding they land in.
  const [accountType, setAccountType] = useState<"individual" | "organisation">("organisation");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name"));
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));

    // A visitor who arrived via "Personalise this card" carries their chosen
    // card in ?card= (and usually localStorage already). Persist it so /start
    // can drop them into the editor once they're authenticated.
    const search = new URLSearchParams(window.location.search);
    const cardParam = search.get("card");
    if (cardParam) {
      setPendingCardId(cardParam);
    }
    const hasPendingCard = Boolean(cardParam) || Boolean(readPendingCardId());

    // A visitor who chose a paid plan carries it in ?plan= — remembered so the
    // guided setup can offer to activate it once they're in.
    const planParam = search.get("plan");
    if (planParam) {
      setPendingPlan(planParam);
    }

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
      // onboarding flow in (app)/layout.tsx). The pending card waits in
      // localStorage and is picked up after they log in.
      setSubmitting(false);
      setCheckEmail(true);
      return;
    }

    try {
      await apiFetch("/accounts", data.session.access_token, {
        method: "POST",
        body: JSON.stringify({ type: accountType, name }),
      });
    } catch (apiError) {
      setSubmitting(false);
      setError(apiError instanceof ApiError ? apiError.message : "Could not create your account");
      return;
    }

    // Personalise-a-card visitors finish in the editor; everyone else starts in
    // the guided setup, whose first job is importing their contact list.
    router.push(hasPendingCard ? "/start" : "/get-started");
    router.refresh();
  }

  if (checkEmail) {
    return (
      <p className="text-muted">
        Check your email to confirm your account, then{" "}
        <Link href="/login" className="text-accent hover:underline">
          log in
        </Link>
        .
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
      <h1 className="text-xl font-bold tracking-tight">Create your account</h1>
      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}
      <div className="flex flex-col gap-1.5 text-sm">
        <span>Who&apos;s this for?</span>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "individual", label: "Just for me", hint: "Friends & family" },
              { value: "organisation", label: "My organisation", hint: "Business, club, centre" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setAccountType(option.value)}
              className={`flex flex-col rounded-md border px-3 py-2 text-left transition-colors ${
                accountType === option.value
                  ? "border-accent bg-accent-soft"
                  : "border-border hover:border-foreground/20"
              }`}
            >
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        {accountType === "individual" ? "Your name" : "Organisation name"}
        <input
          type="text"
          name="name"
          required
          className="rounded-md border border-border bg-surface px-3 py-2"
        />
      </label>
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
          minLength={8}
          className="rounded-md border border-border bg-surface px-3 py-2"
        />
      </label>
      <button type="submit" disabled={submitting} className="btn-accent">
        {submitting ? "Creating your account…" : "Start free"}
      </button>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
