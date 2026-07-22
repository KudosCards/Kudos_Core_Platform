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
  subject: string;
  /** Pre-rendered HTML body. */
  html: string;
}

export interface EmailClient {
  /** Send one transactional email. Implementations must resolve on success and
   * reject on a hard failure so callers can log/skip without crashing a cron. */
  sendTransactional(input: SendEmailInput): Promise<void>;
}
