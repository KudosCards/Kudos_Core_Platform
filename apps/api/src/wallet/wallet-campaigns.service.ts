import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalletCampaign } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SUPABASE_ADMIN_CLIENT } from "../supabase/supabase-admin.provider";
import { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import { chunked, mapWithConcurrency } from "../common/map-with-concurrency";
import { CAMPAIGN_SWEEP_BUDGET_MS, startFetchBudget } from "../common/fetch-budget";
import { runSerializable } from "../common/run-serializable";
import { CAMPAIGN_REFERENCE_PREFIX, campaignReference, WalletService } from "./wallet.service";

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
 * Concurrent **address lookups** in flight, and so the size of one window.
 *
 * It bounds the Supabase round trips, which are the slow part of a credit. It
 * deliberately does **not** bound concurrent credits: those are applied one at
 * a time, for the reason written on `sweepOne`. Deliberately small either way —
 * the sweep has an hour and no one is waiting on it.
 */
export const CAMPAIGN_SWEEP_CONCURRENCY = 4;

/** What one sweep did, returned for tests and for the ops readout. */
export interface CampaignSweepSummary {
  campaignsConsidered: number;
  credited: number;
  creditedMinor: number;
  /**
   * Accounts the sweep looked at and deliberately did not credit: already
   * credited, address unconfirmed, outside the window, campaign no longer live.
   * Nothing is owed and nothing is wrong.
   */
  skipped: number;
  /**
   * Accounts the sweep **should** have credited and could not — the credit threw
   * and was swallowed so the rest of the batch could finish.
   *
   * Split out of `skipped`, which used to carry both. One counter meant an
   * operator could not tell "twelve weren't eligible" from "twelve are owed
   * money we failed to pay", and the second is the only one worth waking up for.
   * Recoverable — the account still has no campaign ledger entry, so the next
   * sweep retries it — but a number that stays above zero is a real fault.
   */
  failed: number;
  exhausted: string[];
  /** True when the wall-clock budget ended the run with accounts still to do. */
  truncated: boolean;
}

/** A sweep candidate, as the eligibility query selects it. */
interface CandidateAccount {
  id: string;
  memberships: { userId: string }[];
}

/** A candidate after its address lookup — the slow half of a credit. */
interface CandidateLookup {
  accountId: string;
  /** The confirmed address, or null when there is not one. */
  email: string | null;
  /** Set when the lookup failed, so the credit is never attempted. */
  failure: string | null;
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
      // A run that failed every credit used to log nothing at all here: the
      // condition asked only about successes, so the one outcome worth noticing
      // was the one that stayed silent. Each failure is logged individually
      // below `sweepOne`, but the count is what says whether it is a blip or a
      // pattern, and it is a warning rather than a log because money is owed.
      if (summary.failed > 0) {
        this.logger.warn(
          `Wallet campaign sweep: ${summary.failed} account(s) eligible but not credited — ` +
            `they will be retried on the next sweep`,
        );
      }
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
      failed: 0,
      exhausted: [],
      truncated: false,
    };

    for (const campaign of campaigns) {
      if (budget.expired()) {
        summary.truncated = true;
        break;
      }
      await this.sweepOne(campaign, summary, budget);
      if (await this.markExhaustedIfSpent(campaign.id)) {
        summary.exhausted.push(campaign.id);
      }
    }
    return summary;
  }

  /**
   * One campaign's batch: addresses confirmed concurrently, credits applied one
   * at a time.
   *
   * **Why the credits are serial.** `creditCampaign` runs in a Serializable
   * transaction that sums every ledger entry for the campaign to check the
   * budget, and then inserts a row into that same set. Two of those running at
   * once each read the predicate the other writes, which is a serialization
   * cycle by construction — not bad luck. Postgres cancels one as a pivot, and
   * on a loaded database a loser can exhaust all five retries inside the window
   * the winner is still committing in. The credit then throws, gets swallowed
   * below, and an eligible customer silently goes unpaid until the next sweep.
   *
   * That was not theoretical: it reached CI twice, on two unrelated PRs, as
   * `credited: 1` where the test expected 2, with the Postgres log showing one
   * backend losing the race six times in 300 ms on
   * `INSERT INTO wallet_ledger_entries`. `run-serializable.ts` already names the
   * same scenario in its own comment; the jitter it added made it rarer without
   * making it impossible, because the conflict is structural.
   *
   * Applying the credits one at a time removes it at the source. Nothing is
   * lost by doing so: a credit is a short database transaction, the sweep has an
   * hour, and the concurrency was only ever worth having for the Supabase round
   * trip — which is still concurrent, a window at a time.
   *
   * **Why a window rather than two passes.** Looking every address up first
   * would do 200 round trips for a campaign that can afford three more credits.
   * A window of `CAMPAIGN_SWEEP_CONCURRENCY` keeps the batch stopping within one
   * window of the budget running out, and keeps candidates in `createdAt` order,
   * so a budget that runs out mid-batch pays the earliest sign-ups rather than
   * whichever four addresses happened to resolve first.
   *
   * Stops early once a credit comes back `budget_exhausted`, because the rest
   * of the batch would only be refused for the same reason. Whether the
   * campaign is *actually* spent is not decided here — see
   * `markExhaustedIfSpent`.
   */
  private async sweepOne(
    campaign: WalletCampaign,
    summary: CampaignSweepSummary,
    budget: { expired: () => boolean },
  ): Promise<void> {
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
    /** Marks the summary on the way out, so both loops read the same way. */
    const overBudget = (): boolean => {
      if (!budget.expired()) return false;
      summary.truncated = true;
      return true;
    };
    const couldNotCredit = (accountId: string, reason: string): void => {
      summary.failed += 1;
      this.logger.error(`Campaign ${campaign.id} could not credit ${accountId}: ${reason}`);
    };

    for (const window of chunked(candidates, CAMPAIGN_SWEEP_CONCURRENCY)) {
      if (exhausted || overBudget()) break;

      // The slow half, in parallel: one Supabase round trip each.
      const looked = await mapWithConcurrency(window, CAMPAIGN_SWEEP_CONCURRENCY, (account) =>
        this.lookUpAddress(account),
      );

      // The contended half, one at a time. See this method's comment.
      for (const entry of looked) {
        if (exhausted || overBudget()) break;

        if (entry.failure !== null) {
          couldNotCredit(entry.accountId, entry.failure);
          continue;
        }
        // One bad account must not take the batch down — ADR 0186.
        try {
          const outcome = await this.wallet.creditCampaign(entry.accountId, campaign, entry.email);
          if (outcome.status === "credited") {
            summary.credited += 1;
            summary.creditedMinor += outcome.amountMinor;
          } else if (outcome.status === "budget_exhausted") {
            exhausted = true;
          } else {
            summary.skipped += 1;
          }
        } catch (error) {
          couldNotCredit(entry.accountId, error instanceof Error ? error.message : "Unknown error");
        }
      }
    }
  }

  /**
   * One candidate's confirmed address, with any failure carried rather than
   * thrown — the window is resolved with `Promise.all` underneath, where one
   * rejection would abandon the three beside it.
   */
  private async lookUpAddress(account: CandidateAccount): Promise<CandidateLookup> {
    const accountId = account.id;
    const userId = account.memberships[0]?.userId;
    if (!userId) {
      // The query already required an owner membership, so this is a race (the
      // membership went away underneath us), not an ineligible account — which
      // is why it counts as failed rather than skipped.
      return {
        accountId,
        email: null,
        failure: "no owner membership to confirm an address against",
      };
    }
    try {
      return { accountId, email: await this.confirmedEmailFor(userId), failure: null };
    } catch (error) {
      return {
        accountId,
        email: null,
        failure: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * A campaign that can no longer afford its next credit stops, and says so.
   *
   * Derived from the ledger at the moment of the write, not from what the batch
   * happened to observe. Inferring it from a refused credit meant exhaustion
   * could only ever be noticed by an account arriving *after* the money ran
   * out: spend a budget exactly and the campaign sat at `live` with no alert
   * until the next eligible sign-up, which for a £100 campaign at £5 a head is
   * the gap between the twentieth account and the twenty-first. It also meant
   * the decision was taken from a campaign row read at the start of a batch
   * that may have run for minutes — an operator topping the budget up during it
   * would have had the campaign stopped underneath them.
   *
   * Serializable and re-read, so the status, the budget and the spend it is
   * compared against all come from the same instant. Status-guarded on `live`,
   * so two overlapping sweeps cannot both move it and file the alert twice; the
   * notification is keyed on the campaign id as well, which is the belt to that
   * braces.
   *
   * Returns whether this call is the one that stopped it.
   */
  private async markExhaustedIfSpent(campaignId: string): Promise<boolean> {
    const stopped = await runSerializable(this.prisma, async (tx) => {
      const campaign = await tx.walletCampaign.findUnique({ where: { id: campaignId } });
      if (!campaign || campaign.status !== "live") return null;

      const { _sum } = await tx.walletLedgerEntry.aggregate({
        where: { reference: campaignReference(campaign.id) },
        _sum: { amountMinor: true },
      });
      const spent = _sum.amountMinor ?? 0;
      // Room for one more credit is room: the campaign is spent when it can no
      // longer pay the amount it promises, not when it hits the number exactly.
      if (spent + campaign.amountMinor <= campaign.budgetMinor) return null;

      await tx.walletCampaign.update({
        where: { id: campaign.id },
        data: { status: "exhausted" },
      });
      return campaign;
    });
    if (!stopped) return false;

    // After the commit, and from the row the decision was actually made on — an
    // alert about money that quotes a budget nobody set is worse than no alert.
    await this.platformNotifications.notifyAllAdmins({
      kind: "wallet_campaign_exhausted",
      title: `Wallet campaign "${stopped.name}" has spent its budget`,
      body:
        `The campaign stopped crediting at its £${(stopped.budgetMinor / 100).toFixed(2)} ` +
        `budget. New sign-ups in its window are no longer being credited.`,
      href: "/admin",
      entityType: "WalletCampaign",
      entityId: stopped.id,
    });
    return true;
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
