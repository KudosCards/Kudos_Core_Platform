"use client";

import type { InvitePreview } from "@kudos/shared-types";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

const ROLE_LABEL: Record<string, string> = { owner: "an owner", admin: "an admin", staff: "a staff member" };

const inputClass =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none disabled:opacity-60";

export function InviteAcceptClient({ token, preview }: { token: string; preview: InvitePreview }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "signin">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user?.email ?? null);
      setChecking(false);
    });
  }, []);

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      await clientApiFetch(`/invites/${token}/accept`, { method: "POST" });
      router.push("/dashboard");
      router.refresh();
    } catch (acceptError) {
      setError(
        acceptError instanceof ApiError ? acceptError.message : "Could not accept the invitation",
      );
      setBusy(false);
    }
  }

  async function authenticateThenAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const supabase = createClient();
    const { data, error: authError } =
      mode === "create"
        ? await supabase.auth.signUp({ email: preview.email, password })
        : await supabase.auth.signInWithPassword({ email: preview.email, password });

    if (authError) {
      setBusy(false);
      setError(authError.message);
      return;
    }
    if (!data.session) {
      // Sign-up needs email confirmation first — they can reopen this same link
      // once confirmed (the token stays valid) and accept then.
      setBusy(false);
      setCheckEmail(true);
      return;
    }
    await accept();
  }

  if (checking) {
    return <div className="card h-40 animate-pulse rounded-xl bg-foreground/5" />;
  }

  if (checkEmail) {
    return (
      <div className="card flex flex-col gap-2 p-8 text-center">
        <h1 className="text-xl font-bold">Confirm your email</h1>
        <p className="text-sm text-muted">
          We&apos;ve sent a confirmation link to <strong>{preview.email}</strong>. Confirm it, then
          reopen this invite to finish joining.
        </p>
      </div>
    );
  }

  const roleLabel = ROLE_LABEL[preview.role] ?? preview.role;

  return (
    <div className="card flex flex-col gap-5 p-8">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-xl font-bold">Join {preview.accountName}</h1>
        <p className="text-sm text-muted">
          You&apos;ve been invited to join as {roleLabel}.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      {sessionEmail ? (
        sessionEmail.toLowerCase() === preview.email.toLowerCase() ? (
          <button type="button" onClick={() => void accept()} disabled={busy} className="btn-accent">
            {busy ? "Joining…" : "Accept invitation"}
          </button>
        ) : (
          <p className="text-sm text-muted">
            You&apos;re signed in as <strong>{sessionEmail}</strong>, but this invite is for{" "}
            <strong>{preview.email}</strong>. Sign out and sign back in with the invited email to
            accept.
          </p>
        )
      ) : (
        <form onSubmit={(e) => void authenticateThenAccept(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Email
            <input type="email" value={preview.email} disabled className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {mode === "create" ? "Choose a password" : "Your password"}
            <input type="password" name="password" required minLength={8} className={inputClass} />
          </label>
          <button type="submit" disabled={busy} className="btn-accent">
            {busy
              ? "Please wait…"
              : mode === "create"
                ? "Create login & join"
                : "Sign in & join"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "create" ? "signin" : "create");
              setError(null);
            }}
            className="text-center text-xs text-muted hover:text-foreground"
          >
            {mode === "create"
              ? "Already have a Kudos login? Sign in"
              : "Need a login? Create one"}
          </button>
        </form>
      )}
    </div>
  );
}
