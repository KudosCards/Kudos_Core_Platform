import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import type { Paginated } from "../common/paginated";
import type { CheckoutResult } from "../common/checkout-result";
import { BatchOrdersService, type BatchOrder } from "./batch-orders.service";
import { CreateBatchOrderDto } from "./dto/create-batch-order.dto";
import { ListBatchOrdersQueryDto } from "./dto/list-batch-orders-query.dto";
import { QuickSendDto } from "./dto/quick-send.dto";
import { BulkSendDto } from "./dto/bulk-send.dto";

@ApiTags("batch-orders")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("batch-orders")
export class BatchOrdersController {
  constructor(private readonly batchOrdersService: BatchOrdersService) {}

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBatchOrderDto,
  ): Promise<BatchOrder> {
    return this.batchOrdersService.create(membership.accountId, user.id, dto);
  }

  /** Guided first-order path: design + one recipient → ready-to-pay draft order.
   * The caller then checks it out via POST /batch-orders/:id/checkout. */
  @Post("quick-send")
  quickSend(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QuickSendDto,
  ): Promise<BatchOrder> {
    return this.batchOrdersService.quickSend(membership.accountId, user.id, dto);
  }

  /** Bulk send: one saved design → many existing contacts → one ready-to-pay
   * draft order, addressed automatically from each contact's record. The caller
   * then checks it out via POST /batch-orders/:id/checkout. */
  @Post("bulk-send")
  bulkSend(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkSendDto,
  ): Promise<BatchOrder> {
    return this.batchOrdersService.bulkSend(membership.accountId, user.id, dto);
  }

  @Get()
  list(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListBatchOrdersQueryDto,
  ): Promise<Paginated<BatchOrder>> {
    return this.batchOrdersService.list(membership.accountId, user.id, query);
  }

  @Get(":id")
  findOne(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<BatchOrder> {
    return this.batchOrdersService.findOne(membership.accountId, user.id, id);
  }

  @Post(":id/checkout")
  checkout(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CheckoutResult> {
    return this.batchOrdersService.checkout(membership.accountId, user.id, id);
  }

  @Post(":id/cancel")
  cancel(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<BatchOrder> {
    return this.batchOrdersService.cancel(membership.accountId, user.id, id);
  }
}
