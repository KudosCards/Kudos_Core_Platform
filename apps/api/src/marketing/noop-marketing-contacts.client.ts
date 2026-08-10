import { Logger } from "@nestjs/common";
import type { MarketingContactInput, MarketingContactsClient } from "./marketing-contacts.client";

/**
 * Used when no platform Brevo key is configured — the app stays bootable and
 * signup runs unchanged; the subscriber sync is logged and dropped rather than
 * sent. Mirrors NoopEmailClient. See docs/adr/0152-subscriber-marketing-lists.md.
 */
export class NoopMarketingContactsClient implements MarketingContactsClient {
  private readonly logger = new Logger(NoopMarketingContactsClient.name);

  upsertContact(input: MarketingContactInput): Promise<void> {
    this.logger.log(
      `Marketing contacts not configured — skipping list ${input.listId} sync for ${input.email}`,
    );
    return Promise.resolve();
  }
}
