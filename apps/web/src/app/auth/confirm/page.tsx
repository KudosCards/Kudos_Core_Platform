"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";

/**
 * Landing page for the signup-confirmation email (register → emailRedirectTo).
 * The link comes back to *our* origin here; this page turns it into a live
 * session and then forwards to /onboarding, which finishes creating the account
 * from the stash saved at registration. Keeping the redirect on the same origin
 * is what makes that stash readable — the whole point of ADR 0080.
 *
 * Session acquisition mirrors SetPasswordForm: a `?token_hash=…&type=…` link is
 * consumed with verifyOtp; otherwise the browser client resolves the PKCE
 * `?code=` / implicit `#access_token` on load and we wait for the session via
 * getSession + onAuthStateChange.
 */
export default function AuthConfirmPage() {
  const router = useRouter();
  const [invalid, setInvalid] = useState(false);
  // The one-time token/code must be consumed exactly once, even under React
  // StrictMode's double-mount in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const supabase = createClient();
    const params = new URLSearchParams(window.location.search);
    let settled = false;
    // Cleanup is assigned only on the code/implicit path (subscription + timer);
    // every other branch resolves synchronously-enough to need none.
    let cleanup = () => {};

    const forward = () => {
      if (settled) return;
      settled = true;
      // Strip the code/token from the URL so a refresh can't replay it, then
      // hand off to onboarding to finish account creation.
      window.history.replaceState(null, "", window.location.pathname);
      router.replace("/onboarding");
    };

    // All state changes happen inside this async flow (never synchronously in
    // the effect body) so a cascading re-render can't be triggered.
    void (async () => {
      // Supabase appends ?error=…&error_description=… when a link is expired or
      // already used — surface the "request a new one" help rather than hanging.
      if (params.get("error")) {
        setInvalid(true);
        return;
      }

      const tokenHash = params.get("token_hash");
      const type = params.get("type") as EmailOtpType | null;
      if (tokenHash && type) {
        const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
        if (data.session && !error) forward();
        else setInvalid(true);
        return;
      }

      // PKCE (?code=) / implicit (#access_token): createBrowserClient resolves it
      // on load (detectSessionInUrl), which getSession awaits. onAuthStateChange
      // is a backstop for the slightly-later SIGNED_IN.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        forward();
        return;
      }
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) forward();
      });
      // If no session materialises, the link was invalid/expired — show help.
      const timer = window.setTimeout(() => {
        if (!settled) setInvalid(true);
      }, 8000);
      cleanup = () => {
        subscription.unsubscribe();
        window.clearTimeout(timer);
      };
    })();

    return () => cleanup();
  }, [router]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <Logo className="h-16 w-auto" priority />
      {invalid ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted">This confirmation link has expired or already been used.</p>
          <Link href="/register" className="text-accent hover:underline">
            Create your account again
          </Link>
        </div>
      ) : (
        <p className="text-muted">Confirming your email…</p>
      )}
    </div>
  );
}
