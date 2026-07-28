import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import {
  SupportService,
  type SupportTicketDetailView,
  type SupportTicketSummaryView,
} from "./support.service";
import { CreateSupportTicketDto } from "./dto/create-support-ticket.dto";
import { SupportReplyDto } from "./dto/support-reply.dto";

/**
 * The subscriber side of support ticketing: raise a ticket from the account
 * area, follow the thread, reply, and close it when done. Account-scoped —
 * everything is filtered to the caller's account. See ADR 0066.
 */
@ApiTags("support")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("support")
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<SupportTicketSummaryView[]> {
    return this.support.listForAccount(membership.accountId);
  }

  @Get(":id")
  get(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SupportTicketDetailView> {
    return this.support.getForAccount(membership.accountId, id);
  }

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupportTicketDto,
  ): Promise<SupportTicketDetailView> {
    return this.support.createTicket(membership.accountId, user.id, dto);
  }

  @Post(":id/reply")
  reply(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SupportReplyDto,
  ): Promise<SupportTicketDetailView> {
    return this.support.reply(membership.accountId, user.id, id, dto);
  }

  @Post(":id/close")
  close(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SupportTicketDetailView> {
    return this.support.close(membership.accountId, user.id, id);
  }
}
