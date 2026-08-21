"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { env } from "@/lib/env";
import {
  getServerConsentSnapshot,
  readConsent,
  subscribeToConsent,
  writeConsent,
  type ConsentChoice,
} from "@/lib/consent";

declare global {
  interface Window {
    /** Defined by the inline gtag bootstrap in <Analytics />. A top-level
     *  `function gtag()` in a classic script is a global, so this is the same
     *  function that pushed the consent default. */
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Asks before analytics cookies are set, and tells GA the answer.
 *
 * Accept and Reject are deliberately equal in size, weight and prominence.
 * Consent isn't valid under PECR if refusing is made harder than agreeing, so
 * that symmetry is a compliance requirement rather than a design preference —
 * please don't restyle one button without the other.
 *
 * Renders nothing until mounted, because the answer lives in localStorage and
 * the server cannot know it. Deciding server-side would either flash the banner
 * at people who already answered or, worse, hide it from people who haven't.
 */
export function CookieBanner() {
  // localStorage is an external store, so it is read through React's store API
  // rather than copied into state inside an effect.
  const choice = useSyncExternalStore(subscribeToConsent, readConsent, getServerConsentSnapshot);

  // No measurement id means no analytics and therefore no non-essential
  // cookies, so there is nothing to ask about. That's every local build and
  // every deploy preview (see netlify.toml).
  if (!env.NEXT_PUBLIC_GA_MEASUREMENT_ID) {
    return null;
  }

  // The server snapshot covers the server render and hydration; a real choice means
  // it has already been answered. Only `null` — asked, not yet answered —
  // shows the banner.
  if (choice !== null) {
    return null;
  }

  function decide(next: ConsentChoice) {
    // writeConsent dispatches CONSENT_EVENT, which the store subscription picks
    // up — no local state to keep in step.
    writeConsent(next);

    // `update` is the only way consent moves once a default has been set —
    // pushing another default is ignored. Called through the same gtag the
    // bootstrap defined, so the argument shape matches what it expects.
    window.gtag?.("consent", "update", {
      analytics_storage: next === "granted" ? "granted" : "denied",
    });
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie choices"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-4px_24px_rgba(15,23,42,0.08)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          We&rsquo;d like to use analytics cookies to understand how the site is used. They&rsquo;re
          off unless you say yes, and the site works either way.{" "}
          <Link href="/privacy" className="font-medium text-slate-900 underline">
            Privacy policy
          </Link>
        </p>
        {/* Equal weight, deliberately — see the note above the component. */}
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide("denied")}
            className="flex-1 rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition-colors ring-inset hover:text-slate-900 hover:ring-slate-400 sm:flex-none"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => decide("granted")}
            className="flex-1 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:flex-none"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
