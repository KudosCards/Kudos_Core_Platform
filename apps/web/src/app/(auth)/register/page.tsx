"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/site-url";
import { apiFetch, ApiError } from "@/lib/api";
import { readPendingCardId, setPendingCardId } from "@/lib/pending-card";
import { setPendingPlan } from "@/lib/pending-plan";
import { setPendingAccount, clearPendingAccount } from "@/lib/pending-account";

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
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));

    // Individuals give their first + last name (so we capture an exact surname
    // for the Brevo list); organisations give a single organisation name. For an
    // individual the account's display `name` is the two joined. `firstName` /
    // `lastName` are sent to the API only for individuals. See ADR 0152.
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const name =
      accountType === "individual"
        ? [firstName, lastName].filter(Boolean).join(" ")
        : String(formData.get("name")).trim();
    const contactName =
      accountType === "individual"
        ? { firstName: firstName || undefined, lastName: lastName || undefined }
        : {};

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
    // Pin the confirmation email's redirect to our own origin + /auth/confirm.
    // Without this, Supabase falls back to the dashboard "Site URL", which sent
    // people to the wrong (Netlify) domain — a different origin from the one that
    // holds their pending-account stash, so the account never got created. The
    // target must also be on the project's Redirect URLs allow-list. See ADR 0080.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${getSiteUrl()}/auth/confirm` },
    });

    if (signUpError) {
      setSubmitting(false);
      setError(signUpError.message);
      return;
    }

    if (!data.session) {
      // Email confirmation is required before a session exists — the account
      // gets created once they confirm and log in (see /onboarding). Stash the
      // chosen type + name so onboarding finishes set-up without asking for the
      // organisation name a second time; the pending card/plan wait alongside it.
      setPendingAccount({ type: accountType, name, ...contactName });
      setSubmitting(false);
      setCheckEmail(true);
      return;
    }

    try {
      await apiFetch("/accounts", data.session.access_token, {
        method: "POST",
        body: JSON.stringify({ type: accountType, name, ...contactName }),
      });
      // Created inline — no confirmation hop — so drop any stale stash.
      clearPendingAccount();
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
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
          {error}
        </p>
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
      {accountType === "individual" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            First name
            <input
              type="text"
              name="firstName"
              required
              autoComplete="given-name"
              className="rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Last name
            <input
              type="text"
              name="lastName"
              required
              autoComplete="family-name"
              className="rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
        </div>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          Organisation name
          <input
            type="text"
            name="name"
            required
            autoComplete="organization"
            className="rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
      )}
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
