"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Account } from "@kudos/shared-types";
import { createClient } from "@/lib/supabase/client";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { setPendingClaimToken, clearPendingClaimToken } from "@/lib/pending-claim";

const CORAL = "#ef5b52";
const inputClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";

/**
 * Claim a guest account: set a password for the email the order was bought with,
 * which attaches a login to the account the card already lives on. If Supabase
 * defers the session for email confirmation, the token is stashed and
 * /onboarding finishes the claim after they log in. See docs/adr/0025.
 */
export function ClaimClient({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });

    if (signUpError) {
      setSubmitting(false);
      setError(signUpError.message);
      return;
    }

    if (!data.session) {
      // Email confirmation required first — stash the token so /onboarding can
      // finish the claim once they confirm and log in.
      setPendingClaimToken(token);
      setSubmitting(false);
      setCheckEmail(true);
      return;
    }

    try {
      await clientApiFetch<Account>("/guest/claim", {
        method: "POST",
        body: JSON.stringify({ claimToken: token }),
      });
    } catch (claimError) {
      setSubmitting(false);
      setError(claimError instanceof ApiError ? claimError.message : "Could not claim your account");
      return;
    }

    clearPendingClaimToken();
    // Straight into the guided setup — save more contacts, turn on reminders.
    router.push("/get-started");
    router.refresh();
  }

  if (checkEmail) {
    return (
      <p className="text-slate-600">
        Almost there — check your email to confirm your account, then{" "}
        <Link href="/login" className="font-medium text-rose-600 hover:underline">
          log in
        </Link>{" "}
        and we&apos;ll finish saving your order.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600">{error}</p>
      )}
      <label className="flex flex-col gap-1 text-sm text-slate-600">
        Email
        <input type="email" value={email} disabled className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-600">
        Choose a password
        <input type="password" name="password" required minLength={8} className={inputClass} />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="mt-1 rounded-full px-6 py-3 text-center font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ backgroundColor: CORAL }}
      >
        {submitting ? "Creating your account…" : "Save my order & create account"}
      </button>
    </form>
  );
}
