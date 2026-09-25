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
    // but required for the HTML fallback. Refused here rather than sent and
    // rejected: without a sender Brevo 400s the whole request, so the caller
    // learned nothing and the send never reached Brevo's dashboard to be found
    // later. The password reset, both invites and the RTS notice are all
    // HTML-only by construction. See ADR 0267.
    if (!input.templateId && !this.fromAddress) {
      this.logger.error(
        `Cannot send "${input.subject}" — EMAIL_FROM_ADDRESS is not a verified Brevo sender, so this email has no from address.`,
      );
      throw new BadGatewayException("Email sender is not configured");
    }
    const sender = this.fromAddress
      ? { sender: { email: this.fromAddress, name: this.fromName } }
      : {};
    const content = input.templateId
      ? { templateId: input.templateId, params: input.params ?? {} }
      : {
          subject: input.subject,
          htmlContent: input.html ?? "",
          // A plain-text alternative alongside the HTML. Brevo does not
          // synthesise one, and a single-part HTML-only message carrying one
          // remote image and a long tokenised link is exactly the shape spam
          // filters score down — which matters most for the auth emails people
          // report as "never arrived".
          textContent: plainTextFrom(input.html ?? "", input.subject),
        };

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

/**
 * A readable text/plain alternative derived from the HTML we already built.
 *
 * Deliberately crude — it is the fallback part, not the message. Links are kept
 * as "label: url" because a reset email is useless without its URL, the hidden
 * preheader and any style/script content are dropped, and entities are undone
 * so the text does not read as markup.
 */
export function plainTextFrom(html: string, subject: string): string {
  const withoutHead = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ");
  const withLinks = withoutHead.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_whole, href: string, label: string) => {
      const text = label
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return text && !text.includes(href) ? ` ${text}: ${href} ` : ` ${href} `;
    },
  );
  const text = withLinks
    .replace(/<\/(?:p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
  return text.length > 0 ? text : subject;
}
