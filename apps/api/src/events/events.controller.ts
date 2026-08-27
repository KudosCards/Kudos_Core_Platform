import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import type { BatchOrder } from "../batch-orders/batch-orders.service";
import { EventsService, type EventSummary, type EventWithMembers } from "./events.service";
import { CreateEventDto } from "./dto/create-event.dto";
import { UpdateEventDto } from "./dto/update-event.dto";
import { AddEventMembersDto } from "./dto/add-event-members.dto";
import { OrderEventDto } from "./dto/order-event.dto";
import { ListEventsQueryDto } from "./dto/list-events-query.dto";

@ApiTags("events")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("events")
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEventDto,
  ): Promise<EventWithMembers> {
    return this.eventsService.create(membership.accountId, user.id, dto);
  }

  @Get()
  list(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEventsQueryDto,
  ): Promise<EventSummary[]> {
    return this.eventsService.list(membership.accountId, user.id, query);
  }

  @Get(":id")
  findOne(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<EventWithMembers> {
    return this.eventsService.findOne(membership.accountId, user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ): Promise<EventWithMembers> {
    return this.eventsService.update(membership.accountId, user.id, id, dto);
  }

  @Post(":id/members")
  addMembers(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddEventMembersDto,
  ): Promise<EventWithMembers> {
    return this.eventsService.addMembers(membership.accountId, user.id, id, dto);
  }

  @Delete(":id/members/:recipientId")
  @HttpCode(204)
  removeMember(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("recipientId", ParseUUIDPipe) recipientId: string,
  ): Promise<void> {
    return this.eventsService.removeMember(membership.accountId, user.id, id, recipientId);
  }

  /** Send the whole cohort — returns a draft order the caller then pays. */
  @Post(":id/order")
  order(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: OrderEventDto,
  ): Promise<BatchOrder> {
    return this.eventsService.order(membership.accountId, user.id, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.eventsService.remove(membership.accountId, user.id, id);
  }
}
