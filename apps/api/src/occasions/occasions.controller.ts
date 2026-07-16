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
import { OccasionsService, type Occasion } from "./occasions.service";
import { CreateOccasionDto } from "./dto/create-occasion.dto";
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
}
