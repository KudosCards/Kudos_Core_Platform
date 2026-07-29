"use client";

/**
 * The account a visitor set up on /register, stashed across the email-
 * confirmation hop so /onboarding can finish creating it **without asking for
 * the organisation (or personal) name a second time**. When sign-up needs email
 * confirmation there's no session yet, so /register can't create the account —
 * without this, the name entered there is lost and onboarding re-prompts for it.
 * Mirrors pending-plan.ts / pending-card.ts. See docs/adr/0019-guided-onboarding.md.
 */
const KEY = "kudos:pendingAccount";

export type PendingAccountType = "individual" | "organisation";

export interface PendingAccount {
  type: PendingAccountType;
  name: string;
}

function isType(value: unknown): value is PendingAccountType {
  return value === "individual" || value === "organisation";
}

export function setPendingAccount(account: PendingAccount): void {
  if (!isType(account.type) || !account.name.trim()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ type: account.type, name: account.name }));
  } catch {
    // Private mode / storage disabled — non-fatal; onboarding falls back to its
    // own set-up form.
  }
}

/** The raw stored string — a stable snapshot for useSyncExternalStore (parsing
 * would return a fresh object each render and loop). Null when nothing/unreadable. */
export function readPendingAccountRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Pure parse + validation of a stored value (or null). */
export function parsePendingAccount(raw: string | null): PendingAccount | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingAccount>;
    if (isType(parsed.type) && typeof parsed.name === "string" && parsed.name.trim()) {
      return { type: parsed.type, name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
}

export function readPendingAccount(): PendingAccount | null {
  return parsePendingAccount(readPendingAccountRaw());
}

export function clearPendingAccount(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // no-op
  }
}
