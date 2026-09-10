import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { WalletCampaign, WalletCampaignStatus } from "@prisma/client";
import {
  londonDay,
  londonDayAfter,
  londonDayStart,
  type WalletCampaignView,
} from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformNotificationService } from "../platform-notifications/platform-notification.service";
import { campaignReference } from "./wallet.service";
import type { CreateWalletCampaignDto, UpdateWalletCampaignDto } from "./dto/wallet-campaign.dto";

/**
 * Campaigns returned by one list call.
 *
 * Campaigns are created by hand a few times a year, so this is not a bound on
 * traffic — it is a bound on a mistake, in the shape ADR 0155 asks for: no
 * query returns "however many rows there happen to be".
 */
export const CAMPAIGN_LIST_LIMIT = 100;

/** What a campaign has paid out, keyed by campaign id. */
type Spend = Map<string, { count: number; minor: number }>;

/**
 * Which statuses an operator may move a campaign to by hand.
 *
 * `exhausted` is not reachable from here at all — only spending the budget
 * produces it, and the way back is to raise the budget (see `update`), which
 * says what actually changed. `ended` is terminal: a campaign that has stopped
 * making an offer cannot start making it again, because the people who signed
 * up in the gap would have no way to tell.
 */
const LEGAL_TRANSITIONS: Record<WalletCampaignStatus, WalletCampaignStatus[]> = {
  draft: ["live", "ended"],
  live: ["paused", "ended"],
  paused: ["live", "ended"],
  exhausted: ["ended"],
  ended: [],
};

/**
 * The operator's half of wallet campaigns: create one, correct it, start it,
 * pause it, stop it, and see what it has cost.
 *
 * Separate from `WalletCampaignsService` because they are different jobs with
 * different failure modes. That one runs unattended and must never take a batch
 * down over one bad account; this one runs behind a super admin who is waiting
 * for an answer, so it throws — a refused edit that looked like it worked is
 * worse than an error.
 *
 * See docs/wallet-campaigns-plan.md.
 */
@Injectable()
export class WalletCampaignsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformNotifications: PlatformNotificationService,
  ) {}

  async list(): Promise<WalletCampaignView[]> {
    const campaigns = await this.prisma.walletCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: CAMPAIGN_LIST_LIMIT,
    });
    const spend = await this.spendFor(campaigns.map((campaign) => campaign.id));
    return campaigns.map((campaign) => this.view(campaign, spend));
  }

  /**
   * Create a campaign, always `draft`.
   *
   * Nothing is paid out until somebody looks at what they typed and sets it
   * live, which is the whole reason a draft state exists: the difference
   * between £5 and £50 is one keystroke, and the credit is not reversible
   * (ADR 0012 — no refunds or withdrawals from a wallet).
   */
  async create(adminUserId: string, dto: CreateWalletCampaignDto): Promise<WalletCampaignView> {
    const { startsAt, endsAt } = this.window(dto.startsOn, dto.endsOn);
    const campaign = await this.prisma.walletCampaign.create({
      data: {
        name: dto.name.trim(),
        amountMinor: dto.amountMinor,
        startsAt,
        endsAt,
        budgetMinor: dto.budgetMinor,
        status: "draft",
        createdByUserId: adminUserId,
      },
    });
    return this.view(campaign, new Map());
  }

  /**
   * Correct a campaign.
   *
   * What may change depends on whether the offer has been made. `amountMinor`
   * and the window are draft-only: "sign up in October and get £5" is a promise
   * to everyone in that window, and one credit per account ever (D5) means an
   * early sign-up cannot be topped up to match a later raise. Changing the
   * offer means ending this campaign and starting another.
   *
   * `name` and `budgetMinor` stay editable, because neither is a promise made
   * to a customer — one is a label and the other is a ceiling we set ourselves.
   * Raising the budget on a campaign that already stopped at it puts the
   * campaign back to `live`, which is what an operator topping it up means; the
   * hourly sweep then picks up everyone who was passed over in the meantime,
   * because they are still in-window (D9).
   */
  async update(id: string, dto: UpdateWalletCampaignDto): Promise<WalletCampaignView> {
    const campaign = await this.require(id);
    if (campaign.status === "ended") {
      throw new ConflictException("An ended campaign cannot be edited.");
    }

    const changesTheOffer =
      dto.amountMinor !== undefined || dto.startsOn !== undefined || dto.endsOn !== undefined;
    if (changesTheOffer && campaign.status !== "draft") {
      throw new ConflictException(
        "The amount and dates can only be changed while a campaign is still a draft. " +
          "They are the offer made to everyone in the window, and an account that has " +
          "already been credited cannot be topped up to match. End this campaign and " +
          "start another instead.",
      );
    }

    const spend = await this.spendFor([id]);
    const spent = spend.get(id)?.minor ?? 0;
    if (dto.budgetMinor !== undefined && dto.budgetMinor < spent) {
      throw new BadRequestException(
        `This campaign has already paid out £${(spent / 100).toFixed(2)}, ` +
          "so the budget cannot be set below that.",
      );
    }

    const startsOn = dto.startsOn ?? londonDay(campaign.startsAt);
    const endsOn = dto.endsOn ?? londonDay(new Date(campaign.endsAt.getTime() - 1));
    const { startsAt, endsAt } = this.window(startsOn, endsOn);
    const budgetMinor = dto.budgetMinor ?? campaign.budgetMinor;
    const amountMinor = dto.amountMinor ?? campaign.amountMinor;

    // A top-up big enough for at least one more credit restarts the campaign.
    // Guarded on the status we read, so the sweep exhausting a campaign at the
    // same moment cannot be overwritten by an edit that never saw it.
    const revives =
      campaign.status === "exhausted" && spent + amountMinor <= budgetMinor ? "live" : undefined;

    const { count } = await this.prisma.walletCampaign.updateMany({
      where: { id, status: campaign.status },
      data: {
        name: dto.name?.trim() ?? campaign.name,
        amountMinor,
        startsAt,
        endsAt,
        budgetMinor,
        ...(revives ? { status: revives } : {}),
      },
    });
    if (count === 0) {
      throw new ConflictException("The campaign changed while you were editing it. Reload it.");
    }
    if (revives) {
      await this.announceLive(id);
    }
    return this.view(await this.require(id), spend);
  }

  /**
   * Start, pause, resume or stop a campaign.
   *
   * A pause stops crediting but does not narrow the window (D9): accounts
   * created during the pause are credited on resume, because they signed up
   * inside the window we advertised and the pause was our decision, not theirs.
   */
  async setStatus(id: string, status: "live" | "paused" | "ended"): Promise<WalletCampaignView> {
    const campaign = await this.require(id);
    if (campaign.status === status) {
      return this.view(campaign, await this.spendFor([id]));
    }
    if (!LEGAL_TRANSITIONS[campaign.status].includes(status)) {
      throw new ConflictException(
        `A ${campaign.status} campaign cannot be moved to ${status}.` +
          (campaign.status === "exhausted" && status === "live"
            ? " It has spent its budget — raise the budget to start it again."
            : ""),
      );
    }

    // Status-guarded, so an operator pausing a campaign at the moment the sweep
    // exhausts it cannot overwrite `exhausted` and lose the "budget spent" signal.
    const { count } = await this.prisma.walletCampaign.updateMany({
      where: { id, status: campaign.status },
      data: { status },
    });
    if (count === 0) {
      throw new ConflictException("The campaign changed while you were editing it. Reload it.");
    }
    if (status === "live") {
      await this.announceLive(id);
    }
    return this.view(await this.require(id), await this.spendFor([id]));
  }

  /**
   * Tell every operator that money is now being given away.
   *
   * The mirror of the exhausted alert, and for the same reason: a campaign that
   * silently starts is a campaign nobody knows has started. Keyed on the
   * campaign id, so a pause-and-resume does not file it again — the first time
   * is the one that carries news.
   */
  private async announceLive(id: string): Promise<void> {
    const campaign = await this.require(id);
    await this.platformNotifications.notifyAllAdmins({
      kind: "wallet_campaign_live",
      title: `Wallet campaign "${campaign.name}" is live`,
      body:
        `Every account that signs up between ${londonDay(campaign.startsAt)} and ` +
        `${londonDay(new Date(campaign.endsAt.getTime() - 1))} is credited ` +
        `£${(campaign.amountMinor / 100).toFixed(2)}, up to a total of ` +
        `£${(campaign.budgetMinor / 100).toFixed(2)}.`,
      href: "/admin",
      entityType: "WalletCampaign",
      entityId: campaign.id,
    });
  }

  private async require(id: string): Promise<WalletCampaign> {
    const campaign = await this.prisma.walletCampaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new NotFoundException("Campaign not found");
    }
    return campaign;
  }

  /**
   * The inclusive London days an operator typed, as the half-open instant
   * window `[startsAt, endsAt)` everything downstream compares against.
   *
   * London rather than UTC because the offer is written in UK dates: a window
   * stored as UTC midnight would miss someone who signed up at 00:30 BST on the
   * first, and include someone who signed up at 23:30 BST on the last day of
   * the month before.
   */
  private window(startsOn: string, endsOn: string): { startsAt: Date; endsAt: Date } {
    if (startsOn > endsOn) {
      throw new BadRequestException("The campaign cannot end before it starts.");
    }
    return { startsAt: londonDayStart(startsOn), endsAt: londonDayStart(londonDayAfter(endsOn)) };
  }

  /** What each campaign has paid out, read from the ledger rather than kept on
   *  the campaign — a counter can drift from the money; a SUM cannot. */
  private async spendFor(ids: string[]): Promise<Spend> {
    if (ids.length === 0) return new Map();
    const references = new Map(ids.map((id) => [campaignReference(id), id]));
    const rows = await this.prisma.walletLedgerEntry.groupBy({
      by: ["reference"],
      where: { reference: { in: [...references.keys()] } },
      _count: { _all: true },
      _sum: { amountMinor: true },
    });
    const spend: Spend = new Map();
    for (const row of rows) {
      const id = row.reference ? references.get(row.reference) : undefined;
      if (!id) continue;
      spend.set(id, { count: row._count._all, minor: row._sum.amountMinor ?? 0 });
    }
    return spend;
  }

  private view(campaign: WalletCampaign, spend: Spend): WalletCampaignView {
    const spent = spend.get(campaign.id) ?? { count: 0, minor: 0 };
    return {
      id: campaign.id,
      name: campaign.name,
      amountMinor: campaign.amountMinor,
      startsOn: londonDay(campaign.startsAt),
      // `endsAt` is exclusive — the start of the day after the last day of the
      // window — so the last *included* day is one millisecond before it.
      endsOn: londonDay(new Date(campaign.endsAt.getTime() - 1)),
      budgetMinor: campaign.budgetMinor,
      status: campaign.status,
      creditedCount: spent.count,
      creditedMinor: spent.minor,
      createdAt: campaign.createdAt,
    };
  }
}
