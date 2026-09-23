import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OpsActivityService } from "../ops-activity/ops-activity.service";
import { MESSAGE_DRAFTER } from "./message-drafter.provider";
import {
  MessageDraftingError,
  type DraftRequest,
  type MessageDrafter,
} from "./message-drafting.client";

/**
 * Drafting messages, and everything that keeps it bounded.
 *
 * The client next door makes one call. This decides whether it may be made at
 * all: is a model configured, has this account had its share today, what goes
 * in the request, and what happens when it fails.
 *
 * See docs/adr/0263.
 */

/**
 * How many drafting requests one account may make in a rolling day.
 *
 * Generous for the job — a pool is twenty messages and this returns six at a
 * time — and low enough that a stuck retry loop or a bored subscriber cannot
 * run up a bill worth noticing. Counted from the audit log, which is written
 * on every successful draft, so there is no second table to keep honest.
 */
export const DRAFTS_PER_ACCOUNT_PER_DAY = 20;

/** The audit action every successful draft writes. The cap counts these, so
 *  the string is load-bearing rather than descriptive. */
export const DRAFT_AUDIT_ACTION = "draft_messages";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MessageDraftingService {
  private readonly logger = new Logger(MessageDraftingService.name);

  constructor(
    @Inject(MESSAGE_DRAFTER) private readonly drafter: MessageDrafter | null,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly opsActivity: OpsActivityService,
  ) {}

  /** Whether this deployment can draft at all — false when no key was
   *  configured at boot, which is also when the provider hands over nothing. */
  available(): boolean {
    return this.drafter !== null;
  }

  async draft(accountId: string, actorUserId: string, brief: string | null): Promise<string[]> {
    const drafter = this.drafter;
    if (!drafter) {
      // The page does not offer the button without a key, so reaching here is
      // either a stale tab or somebody with curl. Either way it is the truth.
      throw new ServiceUnavailableException("Message drafting is not switched on");
    }

    const used = await this.prisma.auditLogEntry.count({
      where: {
        accountId,
        action: DRAFT_AUDIT_ACTION,
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
      },
    });
    if (used >= DRAFTS_PER_ACCOUNT_PER_DAY) {
      throw new HttpException(
        `That is ${DRAFTS_PER_ACCOUNT_PER_DAY} sets of suggestions today, which is the limit. Write the next few yourself, or come back tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const request = await this.requestFor(accountId, brief);

    let drafts: string[];
    try {
      drafts = await drafter.draftBirthdayMessages(request);
    } catch (error) {
      await this.reportFailure(accountId, error);
      throw new ServiceUnavailableException(
        "We could not write any suggestions just now. Your own messages are untouched — try again in a minute.",
      );
    }

    // Recorded after the fact, so a failed call does not spend somebody's
    // allowance. It is also the cap's only counter, which means an account that
    // never succeeds is never locked out for it.
    await this.audit.record({
      accountId,
      actorUserId,
      action: DRAFT_AUDIT_ACTION,
      targetType: "StandingOrder",
      targetId: accountId,
      metadata: { drafts: drafts.length, brief: brief ? brief.length : 0 },
    });

    return drafts;
  }

  /**
   * What leaves the platform, decided in one place.
   *
   * The brief is the subscriber's own words. The business name is sent **only
   * for an organisation**: on a personal account the account name is somebody's
   * actual name, and a feature whose whole safety argument is "no personal data
   * is in the prompt" does not get to make an exception for the one person who
   * did not ask.
   */
  private async requestFor(accountId: string, brief: string | null): Promise<DraftRequest> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { name: true, type: true },
    });
    return {
      businessName: account?.type === "organisation" ? account.name : null,
      brief: brief && brief.length > 0 ? brief : null,
    };
  }

  /**
   * A refusal the subscriber can act on is a log line; anything else is an
   * escalation.
   *
   * The distinction matters because this is the only place in the product that
   * depends on somebody else's model. A bad response or a 500 that keeps
   * happening is ours to notice, not theirs to report.
   */
  private async reportFailure(accountId: string, error: unknown): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Message drafting failed for ${accountId}: ${detail}`);
    if (error instanceof MessageDraftingError && error.reason === "unusable") {
      // The model answered and we could not use it. Worth knowing about — a
      // prompt that has stopped working looks exactly like this — but it is not
      // an outage.
      return;
    }
    await this.opsActivity.messageDraftingFailed(accountId, detail);
  }
}
