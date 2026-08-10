import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Account, AccountType } from "@prisma/client";
import type { EnvConfig } from "../config/env.schema";
import {
  MARKETING_CONTACTS_CLIENT,
  type MarketingContactsClient,
} from "./marketing-contacts.client";
import { deriveContactName } from "./derive-contact-name";

/** Individuals only: an exact given/family name captured at signup, used in
 * preference to splitting the free-text `name`. */
export interface ExplicitContactName {
  firstName?: string;
  lastName?: string;
}

/**
 * Adds Kudos Cards subscribers to our company Brevo marketing lists, split by
 * account type: individuals go to one list, organisations to another (list ids
 * are env-configured — see docs/adr/0152-subscriber-marketing-lists.md).
 *
 * Every method here is a best-effort side effect: it must NEVER block or fail
 * whatever triggered it (signup, guest claim), so each swallows and logs any
 * error rather than throwing. Losing a marketing-list write is recoverable (a
 * backfill can re-run it); failing a signup because Brevo hiccuped is not.
 */
@Injectable()
export class MarketingContactsService {
  private readonly logger = new Logger(MarketingContactsService.name);

  constructor(
    @Inject(MARKETING_CONTACTS_CLIENT) private readonly client: MarketingContactsClient,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  private individualListId(): number {
    return this.config.get("BREVO_LIST_ID_INDIVIDUAL", { infer: true });
  }

  private listIdFor(type: AccountType): number {
    return type === "organisation"
      ? this.config.get("BREVO_LIST_ID_ORGANISATION", { infer: true })
      : this.individualListId();
  }

  /**
   * Push a newly-signed-up account's owner into the right Brevo list. `email` is
   * the owner's (from their verified JWT); without one there's no contact to
   * create, so we skip. When `explicit` first/last name is given (individuals
   * who filled the dedicated fields), it's used verbatim; otherwise the name is
   * derived from `account.name`. Errors are logged and swallowed.
   */
  async syncSubscriber(
    account: Pick<Account, "type" | "name">,
    email: string | null,
    explicit?: ExplicitContactName,
  ): Promise<void> {
    if (!email) {
      this.logger.warn(`No email for a new ${account.type} account — skipping marketing sync`);
      return;
    }
    const listId = this.listIdFor(account.type);
    const useExplicit =
      account.type === "individual" && Boolean(explicit?.firstName || explicit?.lastName);
    const { firstName, lastName, company } = useExplicit
      ? { firstName: explicit?.firstName, lastName: explicit?.lastName, company: undefined }
      : deriveContactName(account.type, account.name);
    await this.upsert(email, listId, { firstName, lastName, company });
  }

  /**
   * A guest one-off buyer who just claimed their account (attached a login).
   * They aren't a registered subscriber until this moment, and they're always a
   * person, so they go on the INDIVIDUAL list regardless of account type. We
   * only reliably know their email here (the account name is a derived
   * placeholder), so no name attributes are sent.
   */
  async syncGuestBuyerToIndividualList(email: string | null): Promise<void> {
    if (!email) {
      this.logger.warn("No email for a claimed guest account — skipping marketing sync");
      return;
    }
    await this.upsert(email, this.individualListId(), {});
  }

  private async upsert(
    email: string,
    listId: number,
    attrs: { firstName?: string; lastName?: string; company?: string },
  ): Promise<void> {
    try {
      await this.client.upsertContact({ email, listId, ...attrs });
    } catch (error) {
      this.logger.error(
        `Marketing-list sync failed for ${email} (list ${listId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
