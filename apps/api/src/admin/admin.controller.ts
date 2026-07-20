import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import type { Paginated } from "../common/paginated";
import {
  AdminService,
  type AdminOverview,
  type AdminOrderRow,
  type AdminSubscriberRow,
} from "./admin.service";
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
  constructor(private readonly adminService: AdminService) {}

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
}
