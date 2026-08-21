/**
 * Cookie consent for analytics — the one piece of state the banner and the
 * gtag bootstrap both need to agree on.
 *
 * Analytics cookies are non-essential under PECR, so they may not be set until
 * someone opts in. Google Consent Mode v2 is how that is expressed to GA:
 * storage starts `denied`, gtag still loads and buffers, and nothing is written
 * until an `update` grants it.
 */

/** Where the visitor's choice is remembered. Versioned, so a future change to
 *  what we ask for can invalidate old answers rather than silently inheriting
 *  consent given for something else. */
export const CONSENT_STORAGE_KEY = "kudos.cookie-consent.v1";

export type ConsentChoice = "granted" | "denied";

/** Fired when the banner records a choice, so the gtag bootstrap can react
 *  without the two components importing each other. */
export const CONSENT_EVENT = "kudos:cookie-consent";

/**
 * Read the stored choice. Returns null when nothing has been chosen yet, which
 * is what makes the banner appear.
 *
 * Wrapped because storage access itself throws in some browsers — Safari with
 * cookies blocked, a locked-down corporate profile. A visitor who can't store a
 * choice is treated as not having made one, which errs towards denied.
 */
export function readConsent(): ConsentChoice | null {
  try {
    const value = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

/** Persist a choice and tell the page about it. Storage failure is not fatal:
 *  the choice still applies to this visit, it just isn't remembered. */
export function writeConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Ignored on purpose — see readConsent().
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: choice }));
}

/**
 * Subscribe to consent changes, for `useSyncExternalStore`.
 *
 * localStorage is an external store, so the banner reads it through React's
 * store API rather than copying it into state inside an effect — which
 * cascades renders and is what `react-hooks` rightly objects to.
 */
export function subscribeToConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, onChange);
  // Another tab answering counts too: the banner shouldn't sit there asking a
  // question the visitor has already answered next door.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The value the server renders, and the one the client hydrates with.
 *
 * Deliberately distinct from "no choice yet": the server genuinely cannot know,
 * and rendering the banner on the server would flash it at people who already
 * answered. Must be a stable constant or React re-renders forever.
 */
export const CONSENT_UNREAD = "unread" as const;

export function getServerConsentSnapshot(): typeof CONSENT_UNREAD {
  return CONSENT_UNREAD;
}
