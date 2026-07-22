"use client";

/**
 * A guest's account-claim token, stashed when they sign up to claim but email
 * confirmation defers the session. Once they confirm and land authenticated
 * without an account, /onboarding completes the claim. localStorage so it
 * survives the confirm-email hop in the same browser. See docs/adr/0025.
 */
const KEY = "kudos:pendingClaimToken";

export function setPendingClaimToken(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // Private mode / storage disabled — non-fatal; they can re-open the link.
  }
}

export function readPendingClaimToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingClaimToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // no-op
  }
}
