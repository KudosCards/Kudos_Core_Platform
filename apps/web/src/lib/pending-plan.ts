"use client";

/**
 * The plan a visitor chose on the pricing/plans selection, stashed across the
 * sign-up hops so the guided setup (/get-started) can offer to activate a paid
 * plan once they land authenticated. Free needs no activation, so only "pro" and
 * "centre" are meaningful here. Mirrors pending-card.ts. See
 * docs/adr/0019-guided-onboarding.md.
 */
const KEY = "kudos:pendingPlan";

export type PaidPlan = "pro" | "centre";

export function setPendingPlan(plan: string): void {
  if (plan !== "pro" && plan !== "centre") return;
  try {
    window.localStorage.setItem(KEY, plan);
  } catch {
    // Private mode / storage disabled — non-fatal; they can still upgrade from
    // /get-started or /billing.
  }
}

export function readPendingPlan(): PaidPlan | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "pro" || value === "centre" ? value : null;
  } catch {
    return null;
  }
}

export function clearPendingPlan(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // no-op
  }
}
