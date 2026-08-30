import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type {
  AdminOrderDetail,
  CardSize,
  Customer360,
  DispatchReminderConfig,
  OccasionRedateSummary,
  SeasonalDispatchRule,
} from "@kudos/shared-types";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import type { Paginated } from "../common/paginated";
import { SeatBillingService, type SeatPriceStatus } from "../billing/seat-billing.service";
import { DispatchConfigService } from "../dispatch/dispatch-config.service";
import { BatchOrdersService } from "../batch-orders/batch-orders.service";
import { CardSizeConfigService } from "./card-size-config.service";
import { UpdateSeasonalRulesDto } from "./dto/update-seasonal-rules.dto";
import { UpdateReminderConfigDto } from "./dto/update-reminder-config.dto";
import { UpdatePrintCardSizeDto } from "./dto/update-print-card-size.dto";
import {
  AdminService,
  type AdminOverview,
  type AdminOrderRow,
  type AdminSubscriberRow,
} from "./admin.service";
import { AdminCustomerService } from "./admin-customer.service";
import { AdjustWalletDto } from "./dto/adjust-wallet.dto";
import { SetPlanDto } from "./dto/set-plan.dto";
import { WalletService, type WalletSummary } from "../wallet/wallet.service";
import { ListAdminOrdersQueryDto } from "./dto/list-orders-query.dto";
import { ListSubscribersQueryDto } from "./dto/list-subscribers-query.dto";
import { SuperAdminGuard } from "../auth/super-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import { OpsDigestService, type OpsDigestSummary } from "../ops-activity/ops-digest.service";
import {
  SubscriptionInvoicesService,
  type SubscriptionInvoiceBackfillSummary,
} from "../billing/subscription-invoices.service";
import {
  OccasionSchedulerService,
  type OccasionSchedulerSummary,
} from "../occasions/occasion-scheduler.service";

/**
 * The Kudos super-admin view: platform-wide orders, subscribers, and KPIs.
 * Every route is gated by PlatformAdminGuard — like fulfillment, this is a
 * cross-account-privileged surface, never account-scoped. See docs/adr/0010.
 */
@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminCustomer: AdminCustomerService,
    private readonly seatBilling: SeatBillingService,
    private readonly dispatchConfig: DispatchConfigService,
    private readonly cardSizeConfig: CardSizeConfigService,
    private readonly opsDigest: OpsDigestService,
    private readonly subscriptionInvoices: SubscriptionInvoicesService,
    private readonly batchOrders: BatchOrdersService,
    private readonly wallet: WalletService,
    private readonly occasionScheduler: OccasionSchedulerService,
  ) {}

  /**
   * Send yesterday's digest now, rather than waiting for the 07:30 cron — so an
   * operator can see what the email actually looks like, and confirm the wiring,
   * on the day they set it up. Super-admin only, because it sends real email to
   * every super admin.
   *
   * Deliberately bypasses the once-a-day guard, so it still sends after the
   * morning's run. That guard exists to stop a re-fired cron double-sending; a
   * super admin pressing a button is not that, and a button that answers
   * "already sent" every afternoon can't be used to check anything. Pressing it
   * twice therefore sends twice — which is the point.
   */
  /**
   * Replay Stripe's paid-invoice history into our subscription income table.
   *
   * Needed once because capture only started when the webhook learned to keep
   * these (everything billed before that was discarded), and useful afterwards
   * to repair a gap from a missed webhook or an outage — Stripe, not our event
   * history, is the source of truth.
   *
   * Safe to run at any time, including while webhooks are arriving: every write
   * is an upsert on Stripe's invoice id, so a second run converges rather than
   * double-counting. Super-admin only — it reads the whole billing history.
   */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Post("subscription-invoices/backfill")
  backfillSubscriptionInvoices(): Promise<SubscriptionInvoiceBackfillSummary> {
    return this.subscriptionInvoices.backfill();
  }

  /**
   * Re-date one order's cards to their own recipients' occasions.
   *
   * For an order placed before bulk sends found occasions server-side (#328),
   * where every card was dated the send day rather than each recipient's own
   * birthday. `reschedule` can't fix that — it applies one arrive-by to the
   * whole order, and one shared date is the problem.
   *
   * Also consumes each recipient's natural occasion, because re-dating alone
   * would leave it free to fire a second card on the same day.
   *
   * Super-admin only, one order at a time, and refused once any card has left
   * `pending` — a printed card can't be re-dated, it has already happened.
   * Reports what it changed card by card, and is safe to run twice.
   */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Post("orders/:id/redate-to-occasions")
  redateOrderToOccasions(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<OccasionRedateSummary> {
    return this.batchOrders.redateToRecipientOccasions(admin.userId, id);
  }

  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Post("daily-summary/run")
  runDailySummary(): Promise<OpsDigestSummary> {
    return this.opsDigest.runDailyDigest(new Date(), { force: true });
  }

  /**
   * Run the recurring occasion scheduler now, instead of waiting for 06:00.
   *
   * The same job the cron runs, platform-wide — not a second copy of the rule.
   * Both halves are idempotent: the occasion writes are `skipDuplicates` on the
   * idempotency key, and the promotion is one set-based UPDATE whose WHERE
   * clause stops matching a row once it has moved. So a second run converges
   * rather than doing anything twice, and running it mid-morning simply brings
   * tomorrow's 06:00 forward.
   *
   * Added for the account that imported two thousand contacts and saw an empty
   * Approvals page (#356 fixed that going forward, on the next write to the
   * account; this is how an operator repairs an account that is already in that
   * state without waiting a day, or asking the customer to touch a contact).
   *
   * Super-admin only: it touches every tenant.
   */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Post("occasions/scheduler/run")
  runOccasionScheduler(): Promise<OccasionSchedulerSummary> {
    return this.occasionScheduler.scheduleBirthdayOccasions();
  }

  @Get("overview")
  overview(): Promise<AdminOverview> {
    return this.adminService.overview();
  }

  @Get("orders")
  orders(@Query() query: ListAdminOrdersQueryDto): Promise<Paginated<AdminOrderRow>> {
    return this.adminService.listOrders(query);
  }

  /** One order worked as a unit: header, real fulfilment progress, and card
   * lines (name + occasion + status — no street address). See ADR 0109. */
  @Get("orders/:id")
  order(@Param("id", ParseUUIDPipe) id: string): Promise<AdminOrderDetail> {
    return this.adminService.getOrder(id);
  }

  @Get("subscribers")
  subscribers(@Query() query: ListSubscribersQueryDto): Promise<Paginated<AdminSubscriberRow>> {
    return this.adminService.listSubscribers(query);
  }

  /** Full "Customer 360" for one account — profile + engagement across contacts,
   * occasions, integrations, wallet, team, orders and returns. */
  @Get("customers/:id")
  customer(@Param("id", ParseUUIDPipe) id: string): Promise<Customer360> {
    return this.adminCustomer.getCustomer(id);
  }

  /**
   * Credit (or correct) a customer's wallet by hand — a goodwill gesture to an
   * engaged customer, without running a discount code.
   *
   * Super-admin only, capped at £1,000 either way, a reason required, and
   * audited: this moves money on a customer's account with no payment behind it.
   * A debit cannot take the balance below zero. Idempotent on `requestId`, so a
   * double-submitted form credits once.
   *
   * Note for the books: unlike a top-up, an adjustment has no Stripe payment and
   * therefore no VAT invoice behind it. It is a goodwill credit, not a sale.
   */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Post("customers/:id/wallet-adjustment")
  adjustCustomerWallet(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AdjustWalletDto,
  ): Promise<WalletSummary> {
    return this.wallet.adjustBalance(id, admin.userId, dto);
  }

  /**
   * Set a customer's plan by hand, with no Stripe subscription behind it.
   *
   * For our own internal and test accounts, and for a comped customer. A plan is
   * normally written only by the subscription webhook, from what Stripe says the
   * account is paying for — so this refuses any account with a live subscription
   * rather than setting a value Stripe would later overwrite. See ADR 0172.
   *
   * Super-admin only, a reason required, and audited: it grants paid
   * entitlements with no payment behind them.
   */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Post("customers/:id/plan")
  setCustomerPlan(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetPlanDto,
  ): Promise<{ accountId: string; previousPlanId: string | null; planId: string }> {
    return this.adminCustomer.setPlan(id, admin.userId, dto);
  }

  /** Whether the £5/mo extra-seat Stripe Price is set up, and where its id
   * comes from. Read-only status for the ops "billing setup" panel. */
  @Get("billing/seat-price")
  seatPriceStatus(): Promise<SeatPriceStatus> {
    return this.seatBilling.status();
  }

  /**
   * Provision the extra-seat Stripe Price from the running platform: creates it
   * against this deployment's Stripe account (live in production) if it doesn't
   * exist and stores its id, so seat billing turns on with no dashboard, env
   * var, or redeploy. Idempotent. See docs/adr/0037-in-app-price-provisioning.md.
   */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Post("billing/seat-price")
  ensureSeatPrice(): Promise<SeatPriceStatus> {
    return this.seatBilling.ensureSeatPrice();
  }

  /** The active seasonal dispatch windows (Christmas rush, …) plus the bundled
   * default, so the ops editor can show current config and offer a reset. */
  @Get("dispatch/seasonal-rules")
  seasonalRules(): {
    rules: readonly SeasonalDispatchRule[];
    default: readonly SeasonalDispatchRule[];
  } {
    return {
      rules: this.dispatchConfig.getRules(),
      default: this.dispatchConfig.getDefaultRules(),
    };
  }

  /** Replace the seasonal dispatch windows. Applied immediately + persisted, so
   * dispatch timing changes with no redeploy. See docs/adr/0059. */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Put("dispatch/seasonal-rules")
  async updateSeasonalRules(
    @Body() dto: UpdateSeasonalRulesDto,
  ): Promise<{ rules: readonly SeasonalDispatchRule[] }> {
    return { rules: await this.dispatchConfig.updateRules(dto.rules) };
  }

  /** The send-by-5 reminder config (on/off, send hour, lead window, escalation)
   * plus the bundled default, for the ops editor. See docs/adr/0117. */
  @Get("dispatch/reminder-config")
  async reminderConfig(): Promise<{
    config: DispatchReminderConfig;
    default: DispatchReminderConfig;
  }> {
    return {
      config: await this.dispatchConfig.getReminderConfig(),
      default: this.dispatchConfig.getDefaultReminderConfig(),
    };
  }

  /** Replace the reminder config. Applied on the next run + persisted, so the
   * dispatch reminder changes with no redeploy. See docs/adr/0117. */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Put("dispatch/reminder-config")
  async updateReminderConfig(
    @Body() dto: UpdateReminderConfigDto,
  ): Promise<{ config: DispatchReminderConfig }> {
    return { config: await this.dispatchConfig.updateReminderConfig(dto) };
  }

  /** The default print card size a print run opens on, plus the house default,
   * for the ops print-size panel. Ops can still override per run in the print
   * overlay. See docs/adr/0138-print-card-sizes.md. */
  @Get("print/card-size")
  async printCardSize(): Promise<{ size: CardSize; default: CardSize }> {
    return {
      size: await this.cardSizeConfig.getDefaultSize(),
      default: this.cardSizeConfig.getHouseDefaultSize(),
    };
  }

  /** Set the default print card size. Persisted, so the print run's default
   * changes with no redeploy. See docs/adr/0138. */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Put("print/card-size")
  async updatePrintCardSize(@Body() dto: UpdatePrintCardSizeDto): Promise<{ size: CardSize }> {
    return { size: await this.cardSizeConfig.setDefaultSize(dto.size) };
  }
}
