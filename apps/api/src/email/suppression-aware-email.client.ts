import { Logger } from "@nestjs/common";
import type { EmailSuppressionService } from "../email-suppression/email-suppression.service";
import type { EmailClient, SendEmailInput } from "./email.client";

/**
 * The configured email client, wrapped so that a send Brevo is going to drop
 * says so in the log.
 *
 * Brevo accepts the API call for a blocklisted address, returns a message id
 * and never delivers. Nothing downstream can tell that apart from a successful
 * send, which is how a customer's missing password reset survived a check of
 * Brevo, Supabase, custom SMTP and the blocklist without anyone finding it
 * (ADR 0267, ADR 0268).
 *
 * ## Why it still sends
 *
 * Refusing would be the obvious move and it is the wrong one. Brevo drops the
 * message either way, so nothing is gained — and the attempt is what makes
 * Brevo emit the `blocked` event that refreshes our record. Stop sending and
 * the record goes stale, which is the failure this feature exists to end,
 * arriving by a different road. The caller's contract is unchanged: this
 * observes, it does not decide.
 */
export class SuppressionAwareEmailClient implements EmailClient {
  private readonly logger = new Logger(SuppressionAwareEmailClient.name);

  constructor(
    private readonly inner: EmailClient,
    private readonly suppressions: EmailSuppressionService,
  ) {}

  async sendTransactional(input: SendEmailInput): Promise<void> {
    await this.warnIfUndeliverable(input);
    await this.inner.sendTransactional(input);
  }

  /**
   * Never allowed to fail the send. A database hiccup here would stop every
   * email in the platform to gain a log line, so the lookup is best-effort and
   * a failure is reported as itself.
   */
  private async warnIfUndeliverable(input: SendEmailInput): Promise<void> {
    try {
      const suppression = await this.suppressions.find(input.to);
      if (!suppression) return;
      const because = suppression.detail ? `: ${suppression.detail}` : "";
      const since = (suppression.occurredAt ?? suppression.firstSeenAt).toISOString().slice(0, 10);
      this.logger.warn(
        `Brevo has blocked ${input.to} since ${since} (${suppression.reason}${because}) — "${input.subject}" will be accepted and dropped.`,
      );
    } catch (error) {
      this.logger.error(
        `Couldn't check whether ${input.to} is deliverable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
