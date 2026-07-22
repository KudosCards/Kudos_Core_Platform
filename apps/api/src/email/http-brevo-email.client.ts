import { BadGatewayException, Logger } from "@nestjs/common";
import type { EmailClient, SendEmailInput } from "./email.client";

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

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

    const response = await fetch(BREVO_EMAIL_URL, {
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
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error(`Brevo email send failed (${response.status}): ${body}`);
      throw new BadGatewayException(`Brevo email send failed (${response.status})`);
    }
  }
}
