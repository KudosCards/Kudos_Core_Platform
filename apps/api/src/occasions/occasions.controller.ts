import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { OccasionsService, type Occasion } from "./occasions.service";
import { CreateOccasionDto } from "./dto/create-occasion.dto";
import { CreateRecipientEventDto } from "./dto/create-recipient-event.dto";
import { ListOccasionsQueryDto } from "./dto/list-occasions-query.dto";
import { ApproveOccasionDto } from "./dto/approve-occasion.dto";

@ApiTags("occasions")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("occasions")
export class OccasionsController {
  constructor(private readonly occasionsService: OccasionsService) {}

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOccasionDto,
  ): Promise<Occasion> {
    return this.occasionsService.create(membership.accountId, user.id, dto);
  }

  /** Add a hand-curated calendar event (graduation, end of exams, …) to a
   * recipient. Created `scheduled` — see OccasionsService.createRecipientEvent. */
  @Post("events")
  createRecipientEvent(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecipientEventDto,
  ): Promise<Occasion> {
    return this.occasionsService.createRecipientEvent(membership.accountId, user.id, dto);
  }

  @Get()
  list(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOccasionsQueryDto,
  ): Promise<Paginated<Occasion>> {
    return this.occasionsService.list(membership.accountId, user.id, query);
  }

  @Get(":id")
  findOne(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Occasion> {
    return this.occasionsService.findOne(membership.accountId, user.id, id);
  }

  @Post(":id/approve")
  approve(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveOccasionDto,
  ): Promise<Occasion> {
    return this.occasionsService.approve(membership.accountId, user.id, id, dto);
  }

  @Post(":id/skip")
  skip(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Occasion> {
    return this.occasionsService.skip(membership.accountId, user.id, id);
  }

  /** Pull a scheduled event into the approvals queue so a card can be prepared. */
  @Post(":id/prepare")
  prepare(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Occasion> {
    return this.occasionsService.prepare(membership.accountId, user.id, id);
  }

  /** Remove a scheduled event from the calendar (scheduled-only). */
  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.occasionsService.deleteEvent(membership.accountId, user.id, id);
  }
}
