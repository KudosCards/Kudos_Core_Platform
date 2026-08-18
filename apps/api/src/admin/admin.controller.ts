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
  SeasonalDispatchRule,
} from "@kudos/shared-types";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import type { Paginated } from "../common/paginated";
import { SeatBillingService, type SeatPriceStatus } from "../billing/seat-billing.service";
import { DispatchConfigService } from "../dispatch/dispatch-config.service";
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
import { ListAdminOrdersQueryDto } from "./dto/list-orders-query.dto";
import { ListSubscribersQueryDto } from "./dto/list-subscribers-query.dto";
import { SuperAdminGuard } from "../auth/super-admin.guard";
import { OpsDigestService, type OpsDigestSummary } from "../ops-activity/ops-digest.service";

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
  ) {}

  /**
   * Send yesterday's digest now, rather than waiting for the 07:30 cron — so an
   * operator can see what the email actually looks like, and confirm the wiring,
   * on the day they set it up. Super-admin only, because it sends real email to
   * every super admin.
   *
   * Safe to press twice: the in-app entry is keyed on the day being reported, so
   * the second press records nothing and emails nobody. Which also means it
   * won't re-send after the morning's run — that's the same "first run wins"
   * guard the dispatch reminder uses, not a bug.
   */
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  @Post("daily-summary/run")
  runDailySummary(): Promise<OpsDigestSummary> {
    return this.opsDigest.runDailyDigest();
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
  @Put("print/card-size")
  async updatePrintCardSize(@Body() dto: UpdatePrintCardSizeDto): Promise<{ size: CardSize }> {
    return { size: await this.cardSizeConfig.setDefaultSize(dto.size) };
  }
}
