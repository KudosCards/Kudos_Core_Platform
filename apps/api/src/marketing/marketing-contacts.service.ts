import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Account, AccountType } from "@prisma/client";
import type { EnvConfig } from "../config/env.schema";
import {
  MARKETING_CONTACTS_CLIENT,
  type MarketingContactsClient,
} from "./marketing-contacts.client";
import { deriveContactName } from "./derive-contact-name";

/**
 * Adds Kudos Cards subscribers to our company Brevo marketing lists, split by
 * account type: individuals go to one list, organisations to another (list ids
 * are env-configured — see docs/adr/0152-subscriber-marketing-lists.md).
 *
 * The sync is a best-effort side effect of signup: it must NEVER block or fail
 * account creation, so `syncSubscriber` swallows and logs any error rather than
 * throwing. Losing a marketing-list write is recoverable (a backfill can re-run
 * it); failing a signup because Brevo hiccuped is not acceptable.
 */
@Injectable()
export class MarketingContactsService {
  private readonly logger = new Logger(MarketingContactsService.name);

  constructor(
    @Inject(MARKETING_CONTACTS_CLIENT) private readonly client: MarketingContactsClient,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  private listIdFor(type: AccountType): number {
    return type === "organisation"
      ? this.config.get("BREVO_LIST_ID_ORGANISATION", { infer: true })
      : this.config.get("BREVO_LIST_ID_INDIVIDUAL", { infer: true });
  }

  /**
   * Push a newly-signed-up account's owner into the right Brevo list. `email` is
   * the owner's (from their verified JWT); without one there's no contact to
   * create, so we skip. Errors are logged and swallowed — signup must proceed.
   */
  async syncSubscriber(
    account: Pick<Account, "type" | "name">,
    email: string | null,
  ): Promise<void> {
    if (!email) {
      this.logger.warn(`No email for a new ${account.type} account — skipping marketing sync`);
      return;
    }
    const listId = this.listIdFor(account.type);
    const { firstName, lastName, company } = deriveContactName(account.type, account.name);
    try {
      await this.client.upsertContact({ email, firstName, lastName, company, listId });
    } catch (error) {
      this.logger.error(
        `Marketing-list sync failed for ${email} (list ${listId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
