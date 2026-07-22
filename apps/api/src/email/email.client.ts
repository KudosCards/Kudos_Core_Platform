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
}

export interface EmailClient {
  /** Send one transactional email. Implementations must resolve on success and
   * reject on a hard failure so callers can log/skip without crashing a cron. */
  sendTransactional(input: SendEmailInput): Promise<void>;
}
