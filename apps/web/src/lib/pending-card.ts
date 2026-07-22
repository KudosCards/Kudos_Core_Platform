"use client";

/**
 * The card a logged-out visitor chose to personalise, stashed across the sign-up
 * hops (register → email confirm → account setup) so we can drop them straight
 * into the editor for that design once they land authenticated. localStorage
 * (not a cookie/param) so it survives the whole multi-step flow in the same
 * browser. Consumed once by /start. See docs/adr/0017-public-card-library.md.
 */
const KEY = "kudos:pendingCardId";

export function setPendingCardId(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Private mode / storage disabled — the ?card= param on /register is the
    // fallback carrier, so this is non-fatal.
  }
}

export function readPendingCardId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingCardId(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // no-op
  }
}
