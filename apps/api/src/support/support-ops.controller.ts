import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import type { Paginated } from "../common/paginated";
import {
  SupportService,
  type SupportTicketOpsDetailView,
  type SupportTicketOpsSummaryView,
} from "./support.service";
import { SupportOpsReplyDto } from "./dto/support-ops-reply.dto";
import { UpdateSupportTicketDto } from "./dto/update-support-ticket.dto";
import { ListSupportQueryDto } from "./dto/list-support-query.dto";

/**
 * The ops (PlatformAdmin) side of support ticketing: work the cross-account
 * queue, read the full thread (including internal notes), reply to customers,
 * add support-only internal notes, and manage status/priority/assignment. See
 * ADR 0066.
 */
@ApiTags("support-ops")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("admin/support")
export class SupportOpsController {
  constructor(private readonly support: SupportService) {}

  /** The support queue. Defaults to everything not yet closed, longest wait first. */
  @Get()
  list(@Query() query: ListSupportQueryDto): Promise<Paginated<SupportTicketOpsSummaryView>> {
    return this.support.listQueue(query);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string): Promise<SupportTicketOpsDetailView> {
    return this.support.getForOps(id);
  }

  /** Reply to the customer, or add an internal (support-only) note. */
  @Post(":id/reply")
  reply(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SupportOpsReplyDto,
  ): Promise<SupportTicketOpsDetailView> {
    return this.support.opsReply(admin, id, dto);
  }

  /** Change status/priority and (un)assign to self. */
  @Patch(":id")
  update(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupportTicketDto,
  ): Promise<SupportTicketOpsDetailView> {
    return this.support.updateTicket(admin, id, dto);
  }
}
