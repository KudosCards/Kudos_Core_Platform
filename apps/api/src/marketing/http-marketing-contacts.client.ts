import { BadGatewayException, Logger } from "@nestjs/common";
import type { MarketingContactInput, MarketingContactsClient } from "./marketing-contacts.client";

const BREVO_CONTACTS_URL = "https://api.brevo.com/v3/contacts";

/**
 * The real Brevo marketing-contacts client. Never instantiated in tests
 * (MARKETING_CONTACTS_CLIENT is overridden with a mock) — see
 * marketing-contacts.provider.ts.
 *
 * Uses Brevo's create-contact endpoint with `updateEnabled: true`, which is an
 * upsert keyed on email: a repeat call for the same person updates the existing
 * contact and re-affirms its list membership rather than erroring. That makes it
 * safe to call on every signup without tracking whether we've synced before.
 */
export class HttpMarketingContactsClient implements MarketingContactsClient {
  private readonly logger = new Logger(HttpMarketingContactsClient.name);

  constructor(private readonly apiKey: string) {}

  async upsertContact(input: MarketingContactInput): Promise<void> {
    const attributes: Record<string, string> = {};
    if (input.firstName) attributes.FIRSTNAME = input.firstName;
    if (input.lastName) attributes.LASTNAME = input.lastName;
    if (input.company) attributes.COMPANY = input.company;

    const response = await fetch(BREVO_CONTACTS_URL, {
      method: "POST",
      headers: {
        "api-key": this.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        attributes,
        listIds: [input.listId],
        updateEnabled: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error(`Brevo contact upsert failed (${response.status}): ${body}`);
      throw new BadGatewayException(`Brevo contact upsert failed (${response.status})`);
    }
  }
}
