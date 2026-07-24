import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import type { Paginated } from "../common/paginated";
import { ReturnsService, type ReturnCaseView, type RtsQueueItem } from "./returns.service";
import { MarkReturnedDto } from "./dto/mark-returned.dto";
import { ListReturnsQueryDto } from "./dto/list-returns-query.dto";

/**
 * The ops (PlatformAdmin) side of Returned to Sender: mark a card returned and
 * work the RTS queue. Cross-account-privileged, exactly like the fulfillment
 * queue it hangs off (see docs/adr/0010, docs/adr/0039).
 */
@ApiTags("returns-ops")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("admin/returns")
export class ReturnsOpsController {
  constructor(private readonly returns: ReturnsService) {}

  /** The RTS queue. Defaults to open cases (awaiting address / resend). */
  @Get()
  list(@Query() query: ListReturnsQueryDto): Promise<Paginated<RtsQueueItem>> {
    return this.returns.listQueue(query);
  }

  /** Mark a posted/delivered card Returned to Sender, opening a recovery case. */
  @Post()
  markReturned(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body() dto: MarkReturnedDto,
  ): Promise<ReturnCaseView> {
    return this.returns.markReturned(admin.userId, dto);
  }
}
