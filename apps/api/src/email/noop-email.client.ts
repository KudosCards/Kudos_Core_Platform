import { Logger } from "@nestjs/common";
import type { EmailClient, SendEmailInput } from "./email.client";

/**
 * Used when no Brevo key is configured — the app stays bootable and callers
 * (reminder cron, guest receipts) run unchanged; emails are logged and dropped
 * rather than sent. See docs/adr/0025.
 */
export class NoopEmailClient implements EmailClient {
  private readonly logger = new Logger(NoopEmailClient.name);

  sendTransactional(input: SendEmailInput): Promise<void> {
    // Warn, not log. Every send through here is a customer waiting for an
    // email that will never arrive — a password reset among them — and at info
    // level that fact was indistinguishable from ordinary request noise.
    this.logger.warn(`Email not configured — dropping "${input.subject}" to ${input.to}`);
    return Promise.resolve();
  }
}
