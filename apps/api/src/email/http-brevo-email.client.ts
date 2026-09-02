import { BadGatewayException, Logger } from "@nestjs/common";
import { httpRequest } from "../common/http-request";
import type { EmailClient, SendEmailInput } from "./email.client";

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * A deadline of its own, four times the default.
 *
 * The send below deliberately does not retry, because Brevo may have accepted a
 * message and then failed to answer us, and a second attempt puts a second copy
 * in the recipient's inbox. **An abort carries exactly the same ambiguity**, and
 * the 15-second default made it the likelier of the two: a slow-but-successful
 * send throws, the caller treats it as a failure, and the record that would have
 * suppressed a repeat is never written. The reminder digest is the clearest
 * case — an unstamped `reminderSentAt` means tomorrow's run sends the identical
 * email to someone who already has it, which is the duplicate the no-retry rule
 * exists to prevent, arriving a day late.
 *
 * So the deadline is set where an abort really does mean "not delivered" rather
 * than "slow". It still bounds the call: a hung Brevo cannot hold a caller open
 * indefinitely. See ADR 0231.
 */
export const BREVO_EMAIL_TIMEOUT_MS = 60_000;

/**
 * The real Brevo transactional-email client. Never instantiated in tests
 * (EMAIL_CLIENT is overridden with a mock) — see email-client.provider.ts.
 *
 * Supports two modes per send: a Brevo template (`templateId` + `params`, so the
 * design lives in the Brevo dashboard) or our built-in `html` fallback.
 */
export class HttpBrevoEmailClient implements EmailClient {
  private readonly logger = new Logger(HttpBrevoEmailClient.name);

  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string | undefined,
    private readonly fromName: string,
  ) {}

  async sendTransactional(input: SendEmailInput): Promise<void> {
    // A Brevo template carries its own sender, so ours is optional in that mode
    // but required for the HTML fallback.
    const sender = this.fromAddress
      ? { sender: { email: this.fromAddress, name: this.fromName } }
      : {};
    const content = input.templateId
      ? { templateId: input.templateId, params: input.params ?? {} }
      : { subject: input.subject, htmlContent: input.html ?? "" };

    // Deliberately no retry: Brevo may well have accepted and queued a send
    // that then failed to answer us, and a second attempt puts a second copy in
    // the recipient's inbox. A failed send is surfaced instead.
    const response = await httpRequest(
      BREVO_EMAIL_URL,
      {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          ...sender,
          to: [{ email: input.to, ...(input.toName && { name: input.toName }) }],
          ...content,
        }),
      },
      { label: "Brevo email", timeoutMs: BREVO_EMAIL_TIMEOUT_MS },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error(`Brevo email send failed (${response.status}): ${body}`);
      throw new BadGatewayException(`Brevo email send failed (${response.status})`);
    }
  }
}
