import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Customer360 } from "@kudos/shared-types";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import type { Paginated } from "../common/paginated";
import { SeatBillingService, type SeatPriceStatus } from "../billing/seat-billing.service";
import {
  AdminService,
  type AdminOverview,
  type AdminOrderRow,
  type AdminSubscriberRow,
} from "./admin.service";
import { AdminCustomerService } from "./admin-customer.service";
import { ListAdminOrdersQueryDto } from "./dto/list-orders-query.dto";
import { ListSubscribersQueryDto } from "./dto/list-subscribers-query.dto";

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
  ) {}

  @Get("overview")
  overview(): Promise<AdminOverview> {
    return this.adminService.overview();
  }

  @Get("orders")
  orders(@Query() query: ListAdminOrdersQueryDto): Promise<Paginated<AdminOrderRow>> {
    return this.adminService.listOrders(query);
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
}
