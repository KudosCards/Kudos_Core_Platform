import { BadGatewayException, Logger } from "@nestjs/common";
import type { EmailClient, SendEmailInput } from "./email.client";

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * The real Brevo transactional-email client. Never instantiated in tests
 * (EMAIL_CLIENT is overridden with a mock) — see email-client.provider.ts.
 */
export class HttpBrevoEmailClient implements EmailClient {
  private readonly logger = new Logger(HttpBrevoEmailClient.name);

  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
    private readonly fromName: string,
  ) {}

  async sendTransactional(input: SendEmailInput): Promise<void> {
    const response = await fetch(BREVO_EMAIL_URL, {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: this.fromAddress, name: this.fromName },
        to: [{ email: input.to, ...(input.toName && { name: input.toName }) }],
        subject: input.subject,
        htmlContent: input.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error(`Brevo email send failed (${response.status}): ${body}`);
      throw new BadGatewayException(`Brevo email send failed (${response.status})`);
    }
  }
}
