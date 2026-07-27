"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Shared "set a password" screen for the two flows that land a user here from a
 * Supabase email link (operator invite → /admin-set-password, forgot-password →
 * /reset-password). Both arrive with the session in the URL fragment, which the
 * browser client turns into a session; this component waits for that, then lets
 * them set a password via supabase.auth.updateUser. What happens *after* a
 * successful set differs per flow, so the caller passes `onSuccess`. See
 * docs/adr/0051.
 */
export function SetPasswordForm({
  heading,
  intro,
  submitLabel,
  busyLabel,
  onSuccess,
  invalidLinkHelp,
}: {
  heading: string;
  intro: string;
  submitLabel: string;
  busyLabel: string;
  /** Runs after the password is set (with a live session). Do the navigation. */
  onSuccess: () => Promise<void> | void;
  /** Shown when there's no valid session (link expired / opened directly). */
  invalidLinkHelp: ReactNode;
}) {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    // getSession resolves the fragment on load; onAuthStateChange catches the
    // slightly-later PASSWORD_RECOVERY/SIGNED_IN event so we don't race it.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setHasSession(true);
      setChecking(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
      setChecking(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setBusy(false);
      setError(updateError.message);
      return;
    }
    try {
      await onSuccess();
    } catch (successError) {
      setBusy(false);
      setError(
        successError instanceof Error
          ? successError.message
          : "Your password was set, but something went wrong — please try signing in.",
      );
    }
  }

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm";

  if (checking) {
    return <div className="card h-40 animate-pulse rounded-xl bg-foreground/5" />;
  }

  if (!hasSession) {
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <h1 className="text-lg font-bold">This link is invalid or has expired</h1>
        <div className="text-sm text-muted">{invalidLinkHelp}</div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-xl font-bold tracking-tight">{heading}</h1>
        <p className="text-sm text-muted">{intro}</p>
      </div>
      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
          {error}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        New password
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Confirm password
        <input
          type="password"
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <button type="submit" disabled={busy} className="btn-accent">
        {busy ? busyLabel : submitLabel}
      </button>
    </form>
  );
}
