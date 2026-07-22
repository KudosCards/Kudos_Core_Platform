"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiFetch, ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { readPendingCardId } from "@/lib/pending-card";
import { readPendingClaimToken, clearPendingClaimToken } from "@/lib/pending-claim";
import { Logo } from "@/components/logo";

/**
 * Fallback for a user with a valid Supabase session but no Account yet —
 * e.g. they confirmed their email in a separate step from the original
 * signup form. /dashboard redirects here when GET /accounts/me returns 403.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [accountType, setAccountType] = useState<"individual" | "organisation">("organisation");

  // A guest who signed up to claim their order (but had to confirm their email
  // first) lands here with no account yet. If a claim token is waiting, finish
  // the claim — attaching this login to the account their order already lives on
  // — instead of showing the create-account form. See docs/adr/0025.
  const storedClaimToken = useSyncExternalStore(
    () => () => {},
    () => readPendingClaimToken(),
    () => null,
  );
  const [claimDismissed, setClaimDismissed] = useState(false);
  const claimToken = claimDismissed ? null : storedClaimToken;
  const claimAttempted = useRef(false);

  useEffect(() => {
    if (!claimToken || claimAttempted.current) return;
    claimAttempted.current = true;
    void (async () => {
      try {
        await clientApiFetch("/guest/claim", {
          method: "POST",
          body: JSON.stringify({ claimToken }),
        });
        clearPendingClaimToken();
        router.push("/get-started");
        router.refresh();
      } catch {
        // Token expired / already used / user already has an account — drop it
        // and fall back to the normal account setup below.
        clearPendingClaimToken();
        setClaimDismissed(true);
      }
    })();
  }, [claimToken, router]);

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
        body: JSON.stringify({ type: accountType, name }),
      });
    } catch (apiError) {
      setSubmitting(false);
      setError(apiError instanceof ApiError ? apiError.message : "Could not create your account");
      return;
    }

    router.push(readPendingCardId() ? "/start" : "/get-started");
    router.refresh();
  }

  // While a guest claim is being completed, hold the form back so they don't
  // create a second account in parallel.
  if (claimToken) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <Logo className="h-16 w-auto" priority />
        <p className="text-muted">Saving your order…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="h-16 w-auto" priority />
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
          <div className="flex flex-col gap-1.5 text-sm">
            <span>Who&apos;s this for?</span>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: "individual", label: "Just for me" },
                  { value: "organisation", label: "My organisation" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAccountType(option.value)}
                  className={`rounded-md border px-3 py-2 font-medium transition-colors ${
                    accountType === option.value
                      ? "border-accent bg-accent-soft"
                      : "border-border hover:border-foreground/20"
                  }`}
                >
                  {option.label}
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
          <button type="submit" disabled={submitting} className="btn-accent">
            {submitting ? "Setting up…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
