/**
 * Transactional email, behind an interface + injectable token so the real
 * Brevo implementation can be swapped for a mock in tests — the same pattern as
 * BREVO_CLIENT / STRIPE_CLIENT, since this build/test environment has no network
 * path to Brevo. See docs/adr/0025.
 */
export const EMAIL_CLIENT = Symbol("EMAIL_CLIENT");

export interface SendEmailInput {
  to: string;
  toName?: string;
  /** Subject — used for the HTML fallback; a Brevo template supplies its own. */
  subject: string;
  /**
   * A Brevo transactional template id to render in the Brevo dashboard. When
   * set, `params` are passed to it and `html` is ignored — so emails can be
   * customised in Brevo without a code change. Unset ⇒ the `html` fallback.
   */
  templateId?: number;
  /** Dynamic values for the Brevo template (available as {{ params.* }}). */
  params?: Record<string, unknown>;
  /** Pre-rendered HTML body — the built-in fallback when no `templateId` is set. */
  html?: string;
  /**
   * Which verified sender this goes out from.
   *
   * "account" is for mail somebody is locked out without: password resets and
   * invitations. It exists because Brevo scopes unsubscribes and spam
   * complaints **to a sender**, while hard bounces are account-wide. Send
   * everything from one address and unsubscribing from a newsletter silently
   * suppresses that person's password reset — something they never agreed to
   * and cannot see. Our blocklist already carries one of those.
   *
   * Unset means the ordinary sender, which is also what "account" falls back to
   * until a second sender is verified in Brevo. See ADR 0269.
   */
  sender?: "default" | "account";
}

export interface EmailClient {
  /** Send one transactional email. Implementations must resolve on success and
   * reject on a hard failure so callers can log/skip without crashing a cron. */
  sendTransactional(input: SendEmailInput): Promise<void>;
}
