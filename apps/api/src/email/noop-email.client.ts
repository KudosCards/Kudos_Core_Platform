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
    this.logger.log(`Email not configured — skipping "${input.subject}" to ${input.to}`);
    return Promise.resolve();
  }
}
