"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AdminIdentity } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { createClient } from "@/lib/supabase/client";

/**
 * The Kudos operator sign-in — a separate entry from the customer /login. After
 * authenticating against Supabase it calls POST /admin/access, which either
 * confirms operator status (or provisions a newly-invited operator from the
 * email allow-list) and sends them to /admin, or refuses a non-operator. See
 * docs/adr/0040-admin-auth.md.
 */
export default function AdminLoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [notOperator, setNotOperator] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const tryAccess = useCallback(async (): Promise<void> => {
    try {
      await clientApiFetch<AdminIdentity>("/admin/access", { method: "POST" });
      // Full navigation so the ops server layout re-reads the session cookie.
      window.location.assign("/admin");
    } catch (accessError) {
      if (accessError instanceof ApiError && accessError.status === 403) {
        setNotOperator(true);
        return;
      }
      setError(accessError instanceof ApiError ? accessError.message : "Something went wrong");
    }
  }, []);

  // If they arrive already signed in (e.g. bounced from /admin), try straight away.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session && !cancelled) {
        await tryAccess();
      }
      if (!cancelled) setCheckingSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tryAccess]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotOperator(false);
    setSubmitting(true);

    const data = new FormData(event.currentTarget);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: String(data.get("email")),
      password: String(data.get("password")),
    });
    if (signInError) {
      setSubmitting(false);
      setError(signInError.message);
      return;
    }
    await tryAccess();
    setSubmitting(false);
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setNotOperator(false);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="text-2xl font-bold tracking-tight">Kudos Ops</span>
        <span className="text-sm text-muted">Operator sign-in</span>
      </div>

      {notOperator ? (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <h1 className="text-lg font-bold">This account isn&apos;t a Kudos operator</h1>
          <p className="text-sm text-muted">
            Ask a super admin to grant your email operator access, then sign in again.
          </p>
          <button type="button" onClick={() => void signOut()} className="btn-secondary text-sm">
            Use a different account
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => void handleSubmit(event)}
          aria-busy={checkingSession}
        >
          {error && (
            <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
              {error}
            </p>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <button type="submit" disabled={submitting || checkingSession} className="btn-accent">
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}
    </div>
  );
}
