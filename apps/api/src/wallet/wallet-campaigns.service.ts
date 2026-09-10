import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalletCampaign } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SUPABASE_ADMIN_CLIENT } from "../supabase/supabase-admin.provider";
import { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import { mapWithConcurrency } from "../common/map-with-concurrency";
import { CAMPAIGN_SWEEP_BUDGET_MS, startFetchBudget } from "../common/fetch-budget";
import { CAMPAIGN_REFERENCE_PREFIX, WalletService } from "./wallet.service";

/**
 * Accounts one sweep will consider per campaign per run.
 *
 * Signups run at 30-40 a week, so a month-long window is roughly 150 accounts
 * and this is never reached in practice. It is here because "never reached in
 * practice" is a statement about today's traffic, and the failure it prevents —
 * one run trying to credit every account in an unbounded backfill — is the
 * failure ADR 0207 and ADR 0231 are both about. Anything left over is still
 * in-window and waits an hour.
 */
export const CAMPAIGN_SWEEP_BATCH = 200;

/**
 * Concurrent credits in flight. Each is one Supabase lookup plus one
 * serializable transaction, so this is a bound on connections held as much as
 * on outbound calls. Deliberately small: the sweep has an hour and no one is
 * waiting on it.
 */
export const CAMPAIGN_SWEEP_CONCURRENCY = 4;

/** What one sweep did, returned for tests and for the ops readout. */
export interface CampaignSweepSummary {
  campaignsConsidered: number;
  credited: number;
  creditedMinor: number;
  skipped: number;
  exhausted: string[];
  /** True when the wall-clock budget ended the run with accounts still to do. */
  truncated: boolean;
}

/**
 * Delivery for wallet campaigns: an hourly sweep, plus the eager credit the
 * signup path calls so a new customer sees the money immediately.
 *
 * The sweep is the primitive and the hook is the optimisation, not the other
 * way round. `opsActivity.accountSignedUp` — the existing call at the end of
 * signup — swallows its own errors so that a notification problem can never
 * cost a signup, and a credit attached to that path inherits the same silence.
 * The sweep is what makes a missed credit recoverable, and it is the only thing
 * that can serve a window which has already started.
 *
 * See docs/wallet-campaigns-plan.md.
 */
@Injectable()
export class WalletCampaignsService {
  private readonly logger = new Logger(WalletCampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly platformNotifications: PlatformNotificationService,
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly supabaseAdmin: SupabaseClient,
  ) {}

  /**
   * Hourly. No timezone: an hour is an hour everywhere, and the campaign's own
   * window is already stored as instants. See common/scheduling.ts.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledSweep(): Promise<void> {
    try {
      const summary = await this.sweep();
      if (summary.credited > 0 || summary.exhausted.length > 0) {
        this.logger.log(
          `Wallet campaign sweep: credited ${summary.credited} account(s), ` +
            `${summary.creditedMinor}p total${summary.truncated ? " (budget reached)" : ""}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Wallet campaign sweep failed: ${reason}`);
    }
  }

  /**
   * Credit every uncredited, eligible account for every live campaign.
   *
   * Re-runnable by construction: `creditCampaign` is idempotent per account, so
   * a sweep that overlaps another, or re-runs after a partial failure, cannot
   * double-credit anyone.
   */
  async sweep(): Promise<CampaignSweepSummary> {
    const budget = startFetchBudget(CAMPAIGN_SWEEP_BUDGET_MS);
    const campaigns = await this.prisma.walletCampaign.findMany({
      where: { status: "live" },
      orderBy: { startsAt: "asc" },
    });

    const summary: CampaignSweepSummary = {
      campaignsConsidered: campaigns.length,
      credited: 0,
      creditedMinor: 0,
      skipped: 0,
      exhausted: [],
      truncated: false,
    };

    for (const campaign of campaigns) {
      if (budget.expired()) {
        summary.truncated = true;
        break;
      }
      const exhausted = await this.sweepOne(campaign, summary, budget);
      if (exhausted) {
        summary.exhausted.push(campaign.id);
        await this.markExhausted(campaign);
      }
    }
    return summary;
  }

  /** One campaign's batch. Returns whether it ran out of budget. */
  private async sweepOne(
    campaign: WalletCampaign,
    summary: CampaignSweepSummary,
    budget: { expired: () => boolean },
  ): Promise<boolean> {
    const candidates = await this.prisma.account.findMany({
      where: {
        createdAt: { gte: campaign.startsAt, lt: campaign.endsAt },
        // A registration, not a guest checkout. This used to be inferred from
        // "has an owner membership and still holds no claim token", which
        // excluded an *unclaimed* guest exactly and a claimed one not at all —
        // a claim nulls the token and renames the account. `origin` is recorded
        // at creation precisely so this question has an answer.
        origin: "signup",
        // Still required, and not as a second opinion on origin: the owner's
        // userId is what the confirmed-address lookup needs.
        memberships: { some: { role: "owner" } },
        walletEntries: { none: { reference: { startsWith: CAMPAIGN_REFERENCE_PREFIX } } },
      },
      select: {
        id: true,
        memberships: { where: { role: "owner" }, select: { userId: true }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
      take: CAMPAIGN_SWEEP_BATCH,
    });

    let exhausted = false;
    await mapWithConcurrency(candidates, CAMPAIGN_SWEEP_CONCURRENCY, async (account) => {
      if (budget.expired() || exhausted) {
        summary.truncated = summary.truncated || budget.expired();
        return;
      }
      const userId = account.memberships[0]?.userId;
      if (!userId) {
        summary.skipped += 1;
        return;
      }
      // One bad account must not take the batch down — ADR 0186.
      try {
        const email = await this.confirmedEmailFor(userId);
        const outcome = await this.wallet.creditCampaign(account.id, campaign, email);
        if (outcome.status === "credited") {
          summary.credited += 1;
          summary.creditedMinor += outcome.amountMinor;
        } else if (outcome.status === "budget_exhausted") {
          exhausted = true;
        } else {
          summary.skipped += 1;
        }
      } catch (error) {
        summary.skipped += 1;
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Campaign ${campaign.id} could not credit ${account.id}: ${reason}`);
      }
    });
    return exhausted;
  }

  /**
   * A campaign that has spent its budget stops, and says so.
   *
   * Status-guarded on `live`, so two overlapping sweeps cannot both move it and
   * file the alert twice. `notifyAllAdmins` is keyed on the campaign id as
   * well, which is the belt to that braces: a campaign that silently stops is a
   * campaign nobody knows has stopped.
   */
  private async markExhausted(campaign: WalletCampaign): Promise<void> {
    const { count } = await this.prisma.walletCampaign.updateMany({
      where: { id: campaign.id, status: "live" },
      data: { status: "exhausted" },
    });
    if (count === 0) return;
    await this.platformNotifications.notifyAllAdmins({
      kind: "wallet_campaign_exhausted",
      title: `Wallet campaign "${campaign.name}" has spent its budget`,
      body:
        `The campaign stopped crediting at its £${(campaign.budgetMinor / 100).toFixed(2)} ` +
        `budget. New sign-ups in its window are no longer being credited.`,
      href: "/admin",
      entityType: "WalletCampaign",
      entityId: campaign.id,
    });
  }

  /**
   * The eager credit, called by the signup path so a new customer sees the
   * money on their first page rather than up to an hour later.
   *
   * Best-effort and swallowed: a campaign problem must never cost a signup. The
   * hourly sweep is what makes that safe — anything missed here is picked up
   * within the hour, which is exactly why the sweep is the primitive.
   */
  async creditOnSignup(accountId: string, verifiedEmail: string | null): Promise<void> {
    try {
      const now = new Date();
      const campaigns = await this.prisma.walletCampaign.findMany({
        where: { status: "live", startsAt: { lte: now }, endsAt: { gt: now } },
        orderBy: { startsAt: "asc" },
      });
      for (const campaign of campaigns) {
        const outcome = await this.wallet.creditCampaign(accountId, campaign, verifiedEmail);
        // One credit per account, ever: once one campaign has answered for this
        // account there is nothing for a second to do.
        if (outcome.status === "credited" || outcome.status === "already_credited") return;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Campaign credit on signup for ${accountId} failed: ${reason}`);
    }
  }

  /**
   * The account owner's address, but only if Supabase's own record says it is
   * confirmed.
   *
   * The sweep has no request and therefore no token to read, so this asks the
   * record — which is what ADR 0188 concluded should happen wherever an address
   * decides an outcome, and with a campaign live the address decides £5.
   */
  private async confirmedEmailFor(userId: string): Promise<string | null> {
    const { data, error } = await this.supabaseAdmin.auth.admin.getUserById(userId);
    if (error) {
      this.logger.warn(`Could not confirm the address for ${userId}: ${error.message}`);
      return null;
    }
    if (!data.user?.email_confirmed_at) return null;
    return data.user.email ?? null;
  }
}
