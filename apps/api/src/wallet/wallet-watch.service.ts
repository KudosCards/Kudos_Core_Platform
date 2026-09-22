import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import type { Occasion, Recipient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { NotificationInboxService } from "../notifications/notification-inbox.service";
import { OpsActivityService } from "../ops-activity/ops-activity.service";
import { computeCardPriceMinor, computePostageMinor } from "../billing/billing.constants";
import { resolveAccountEmail } from "../common/account-email";
import { PLATFORM_TIME_ZONE } from "../common/scheduling";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, escapeHtml, renderBrandedEmail } from "../email/email-layout";
import { WalletService } from "./wallet.service";
import { type AutoTopUpPauseReason, WALLET_HORIZON_DAYS, autoTopUpPauseCopy } from "./auto-top-up";

/** Nobody triggers the watch — it is a cron, like auto-send's SYSTEM_ACTOR. */
const SYSTEM_ACTOR = "system:wallet-watch";

/** "3 December" — the one date format these messages use, matching the
 * reminder emails so a customer sees one house style. */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

type OccasionWithRecipient = Occasion & { recipient: Recipient | null };

/**
 * What the balance will and will not cover.
 *
 * Deliberately not "is the balance below £X". A threshold answers a question
 * nobody asked; this answers the one they did — how many of the cards I have
 * already approved will actually go, and which one is the first that will not.
 */
export interface WalletProjection {
  balanceMinor: number;
  /** Every committed card in the horizon, priced. */
  committedMinor: number;
  cardsTotal: number;
  /** How many the balance reaches, taking them in the order they go out. */
  cardsCovered: number;
  /** The first card the balance does not reach, or null when it covers them all. */
  firstShortfall: { dispatchDate: Date; recipientName: string } | null;
}

export interface WalletWatchResult {
  accountsConsidered: number;
  toppedUp: number;
  paused: number;
  warned: number;
}

/**
 * The half of the wallet that watches itself.
 *
 * Auto-send spends from the wallet every morning and nothing looked at the
 * balance: the first a customer learned the money had run out was that cards
 * had stopped (and, before ADR 0254, not even that). This runs after auto-send
 * and does two separate things, in this order and for a reason:
 *
 * 1. **Top up**, if the account asked us to and the balance has fallen through
 *    its threshold.
 * 2. **Warn**, if the balance — after any top-up — still does not cover what
 *    has already been approved.
 *
 * The second must not depend on the first. A top-up is a floor, not a promise
 * to cover everything: an account that tops up £50 with £200 of cards due still
 * needs telling. See docs/adr/0255.
 */
@Injectable()
export class WalletWatchService {
  private readonly logger = new Logger(WalletWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly inbox: NotificationInboxService,
    private readonly opsActivity: OpsActivityService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  /** 9am: after the birthday scheduler (6am), auto-send (7am) and the reminder
   * digest (8am), so the day's spending has already happened and the balance
   * this reads is the one the customer actually has. */
  @Cron(CronExpression.EVERY_DAY_AT_9AM, { timeZone: PLATFORM_TIME_ZONE })
  async runDue(): Promise<WalletWatchResult> {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + WALLET_HORIZON_DAYS);

    const accountIds = await this.accountsToWatch(horizon);
    const result: WalletWatchResult = {
      accountsConsidered: accountIds.length,
      toppedUp: 0,
      paused: 0,
      warned: 0,
    };

    // Sequential, like auto-send's own loop: each of these can charge a card,
    // and one account's failure must never stop the accounts behind it.
    for (const accountId of accountIds) {
      try {
        const topped = await this.topUpIfAsked(accountId);
        if (topped === "topped_up") result.toppedUp += 1;
        if (topped === "paused") result.paused += 1;

        const projection = await this.project(accountId, horizon);
        if (projection.firstShortfall && (await this.warn(accountId, projection))) {
          result.warned += 1;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Wallet watch for account ${accountId} failed: ${detail}`);
      }
    }

    this.logger.log(
      `Wallet watch: ${result.accountsConsidered} considered, ${result.toppedUp} topped up, ` +
        `${result.paused} paused, ${result.warned} warned`,
    );
    return result;
  }

  /**
   * Who is worth looking at: anyone who asked to be topped up, plus anyone with
   * a card already approved to go inside the horizon.
   *
   * Accounts already paused are in the second set but not the first — they get
   * no further charge attempts, and they still very much need the warning.
   */
  private async accountsToWatch(horizon: Date): Promise<string[]> {
    const [standing, committed] = await Promise.all([
      this.prisma.account.findMany({
        where: { autoTopUpEnabled: true, autoTopUpPausedAt: null },
        select: { id: true },
      }),
      this.prisma.occasion.findMany({
        where: {
          status: "approved",
          dispatchOption: "auto_send",
          // No lower bound on the dispatch date, on purpose — the same argument
          // RemindersService makes for its own window. A card whose date has
          // already passed and which is still approved is one auto-send could
          // not send this morning: the most urgent thing on the list, and a
          // `gte: today` would drop exactly those.
          dispatchDate: { lte: horizon },
        },
        distinct: ["accountId"],
        select: { accountId: true },
      }),
    ]);
    return [...new Set([...standing.map((a) => a.id), ...committed.map((o) => o.accountId)])];
  }

  /** Run the standing instruction, and pause the account if the charge failed.
   * Returns what happened, for the run tally. */
  private async topUpIfAsked(accountId: string): Promise<"topped_up" | "paused" | "nothing"> {
    const outcome = await this.wallet.autoTopUp(accountId);
    if (outcome.status === "topped_up") {
      return "topped_up";
    }
    if (outcome.status !== "failed") {
      return "nothing";
    }
    await this.pause(accountId, outcome.reason, outcome.detail);
    return "paused";
  }

  /**
   * Stop trying, and say so.
   *
   * Pausing is the point: a card that has been declined will be declined again
   * tomorrow, and a failed charge a day is how an account ends up locked by its
   * own bank. The customer turns it back on once they have fixed the card.
   */
  private async pause(
    accountId: string,
    reason: AutoTopUpPauseReason,
    detail: string,
  ): Promise<void> {
    const paused = await this.prisma.account.updateMany({
      // Guarded on still-unpaused, so a second run in the same day cannot
      // overwrite the first failure's reason with a later one.
      where: { id: accountId, autoTopUpPausedAt: null },
      data: { autoTopUpPausedAt: new Date(), autoTopUpPausedReason: reason },
    });
    if (paused.count === 0) {
      return;
    }

    await this.audit.record({
      accountId,
      actorUserId: SYSTEM_ACTOR,
      action: "wallet_auto_topup_paused",
      targetType: "Wallet",
      targetId: accountId,
      metadata: { reason, detail },
    });
    // A decline we cannot explain is told to the customer *and* raised with
    // Kudos HQ — ADR 0254's rule, and the same reasoning.
    if (reason === "unknown") {
      await this.opsActivity.autoTopUpFailedUnexpectedly(accountId, detail);
    }

    const copy = autoTopUpPauseCopy(reason);
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    try {
      await this.inbox.notifyAccount(accountId, {
        kind: "auto_top_up_paused",
        title: "Automatic top-up has stopped",
        body: `${copy.why} ${copy.fix}`,
        href: "/wallet",
        entityType: "Wallet",
        // Keyed on the reason, so a customer who fixes one problem and hits
        // another hears about the second. Resuming clears the pause, so the
        // same reason recurring later is a new notification too.
        entityId: `${accountId}:${reason}:${new Date().toISOString().slice(0, 10)}`,
      });
    } catch (error) {
      this.logger.error(`Auto top-up pause notice for ${accountId} failed: ${this.reason(error)}`);
    }

    try {
      const to = await resolveAccountEmail(this.prisma, accountId);
      if (!to) return;
      await this.email.sendTransactional({
        to,
        subject: "Your automatic top-up has stopped",
        templateId: this.config.get("BREVO_AUTO_TOP_UP_PAUSED_TEMPLATE_ID", { infer: true }),
        params: { why: copy.why, fix: copy.fix, walletUrl: `${webAppUrl}/wallet` },
        html: renderBrandedEmail({
          webAppUrl,
          preheader: "We could not top up your Kudos wallet — your cards will stop.",
          heading: "Automatic top-up has stopped",
          bodyHtml: `
            <p style="margin:0 0 16px">${escapeHtml(copy.why)} We have switched automatic top-up
              off rather than keep trying, so nothing is charged again until you say so.</p>
            <p style="margin:0 0 16px"><strong>${escapeHtml(copy.fix)}</strong></p>
            <p style="margin:0;color:${BRAND.muted};font-size:13px">Cards already approved will
              keep going while there is balance to cover them. Once there is not, they will wait
              rather than be sent.</p>`,
          cta: { url: `${webAppUrl}/wallet`, label: "Open your wallet" },
        }),
      });
    } catch (error) {
      this.logger.error(`Auto top-up pause email for ${accountId} failed: ${this.reason(error)}`);
    }
  }

  /**
   * Price what the account has already committed to and see how far the balance
   * reaches, taking the cards in the order they go out.
   *
   * Only `approved` + `auto_send` occasions count. A card still awaiting
   * approval is not a commitment — it needs a human before it can cost anything
   * — and counting it would cry wolf about money that may never be spent.
   */
  async project(accountId: string, horizon: Date): Promise<WalletProjection> {
    const [balanceMinor, occasions] = await Promise.all([
      this.wallet.getBalance(accountId),
      this.prisma.occasion.findMany({
        where: {
          accountId,
          status: "approved",
          dispatchOption: "auto_send",
          dispatchDate: { lte: horizon },
        },
        include: { recipient: true },
        orderBy: [{ dispatchDate: "asc" }, { id: "asc" }],
      }),
    ]);

    const cardPriceMinor = await this.cardPriceFor(accountId);
    let committedMinor = 0;
    let cardsCovered = 0;
    let firstShortfall: WalletProjection["firstShortfall"] = null;

    for (const occasion of occasions) {
      committedMinor += cardPriceMinor + computePostageMinor(occasion.postageClass);
      if (committedMinor <= balanceMinor) {
        cardsCovered += 1;
      } else if (!firstShortfall) {
        firstShortfall = {
          // Every occasion in this query matched `dispatchDate: { lte: … }`, so
          // the column cannot be null here; the fallback keeps the type honest
          // rather than asserting.
          dispatchDate: occasion.dispatchDate ?? horizon,
          recipientName: recipientLabel(occasion),
        };
      }
    }

    return {
      balanceMinor,
      committedMinor,
      cardsTotal: occasions.length,
      cardsCovered,
      firstShortfall,
    };
  }

  /** What one card costs this account. An account with no plan is priced
   * undiscounted — the worst case, so a projection is never rosier than the
   * bill. Signup always sets one, so this is the guest/legacy path. */
  private async cardPriceFor(accountId: string): Promise<number> {
    try {
      const entitlement = await this.entitlements.getForAccount(accountId);
      return computeCardPriceMinor(entitlement.cardDiscountPercent);
    } catch {
      return computeCardPriceMinor(0);
    }
  }

  /** Tell them which card is the first their balance will not reach. Returns
   * whether this was news — the inbox dedupe decides, and the email follows it,
   * exactly as auto-send's skip notices do (ADR 0254). */
  private async warn(accountId: string, projection: WalletProjection): Promise<boolean> {
    const shortfall = projection.firstShortfall;
    if (!shortfall) return false;

    const dateLabel = formatDate(shortfall.dispatchDate);
    const shortByMinor = projection.committedMinor - projection.balanceMinor;
    const body =
      projection.cardsCovered === 0
        ? `Your balance does not cover the next card — ${shortfall.recipientName}'s, going out on ${dateLabel}. Top up and it will go as planned.`
        : `Your balance covers the next ${projection.cardsCovered} of ${projection.cardsTotal} cards. ${shortfall.recipientName}'s, on ${dateLabel}, is the first it will not reach.`;

    let recorded: boolean;
    try {
      recorded = await this.inbox.notifyAccount(accountId, {
        kind: "wallet_low_balance",
        title: `Your wallet will not cover ${shortfall.recipientName}'s card`,
        body,
        href: "/wallet",
        entityType: "Wallet",
        // Keyed on the first card that falls short. Told once while nothing
        // changes; a partial top-up moves the date and is genuinely new news.
        entityId: `${accountId}:${shortfall.dispatchDate.toISOString().slice(0, 10)}`,
      });
    } catch (error) {
      this.logger.error(`Low-balance notice for ${accountId} failed: ${this.reason(error)}`);
      return false;
    }
    if (!recorded) return false;

    try {
      const to = await resolveAccountEmail(this.prisma, accountId);
      if (!to) return true;
      const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
      await this.email.sendTransactional({
        to,
        subject: "Your Kudos wallet will not cover the next cards",
        templateId: this.config.get("BREVO_WALLET_LOW_TEMPLATE_ID", { infer: true }),
        params: {
          balanceMinor: projection.balanceMinor,
          committedMinor: projection.committedMinor,
          shortByMinor,
          cardsCovered: projection.cardsCovered,
          cardsTotal: projection.cardsTotal,
          firstShortfallDate: dateLabel,
          firstShortfallName: shortfall.recipientName,
          walletUrl: `${webAppUrl}/wallet`,
        },
        html: renderBrandedEmail({
          webAppUrl,
          preheader: `${shortfall.recipientName}'s card, on ${dateLabel}, is the first your balance will not reach.`,
          heading: "Your wallet is running low",
          bodyHtml: `
            <p style="margin:0 0 16px">${escapeHtml(body)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">
              ${row("Balance", formatMoney(projection.balanceMinor))}
              ${row(`Approved cards in the next ${WALLET_HORIZON_DAYS} days`, formatMoney(projection.committedMinor))}
              ${row("Short by", formatMoney(shortByMinor), true)}
            </table>
            <p style="margin:0;color:${BRAND.muted};font-size:13px">Nothing is cancelled. A card we
              cannot pay for waits rather than being sent, and goes as soon as there is balance
              for it.</p>`,
          cta: { url: `${webAppUrl}/wallet`, label: "Top up" },
        }),
      });
    } catch (error) {
      this.logger.error(`Low-balance email for ${accountId} failed: ${this.reason(error)}`);
    }
    return true;
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
  }
}

/** Who the card is for, as the customer would name them. */
function recipientLabel(occasion: OccasionWithRecipient): string {
  if (occasion.recipient) {
    return `${occasion.recipient.firstName} ${occasion.recipient.lastName}`;
  }
  return occasion.title ?? "a recipient";
}

/** "£12.50" — customer-facing money, always to the penny. */
function formatMoney(minor: number): string {
  return `£${(minor / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function row(label: string, value: string, emphasise = false): string {
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid ${BRAND.border};color:${BRAND.muted}">${escapeHtml(label)}</td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid ${BRAND.border};color:${
        emphasise ? BRAND.accent : BRAND.ink
      };font-weight:600;white-space:nowrap">${escapeHtml(value)}</td>
    </tr>`;
}
