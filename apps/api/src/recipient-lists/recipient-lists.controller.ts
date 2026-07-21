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
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import {
  RecipientListsService,
  type RecipientListSummary,
  type RecipientListWithMembers,
} from "./recipient-lists.service";
import { CreateRecipientListDto } from "./dto/create-recipient-list.dto";
import { UpdateRecipientListDto } from "./dto/update-recipient-list.dto";
import { AddListMembersDto } from "./dto/set-list-members.dto";

/**
 * Recipient lists let a subscriber organise recipients into named groups (a
 * teacher's "Year 4 class", "Year 5 class") for easier bulk personalisation.
 * Every route is account-scoped via MembershipGuard. See
 * docs/adr/0016-recipient-events-and-lists.md.
 */
@ApiTags("recipient-lists")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("recipient-lists")
export class RecipientListsController {
  constructor(private readonly service: RecipientListsService) {}

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecipientListDto,
  ): Promise<RecipientListSummary> {
    return this.service.create(membership.accountId, user.id, dto);
  }

  @Get()
  list(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RecipientListSummary[]> {
    return this.service.list(membership.accountId, user.id);
  }

  @Get(":id")
  findOne(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<RecipientListWithMembers> {
    return this.service.findOne(membership.accountId, user.id, id);
  }

  @Patch(":id")
  rename(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecipientListDto,
  ): Promise<RecipientListSummary> {
    return this.service.rename(membership.accountId, user.id, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(membership.accountId, user.id, id);
  }

  @Post(":id/members")
  addMembers(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AddListMembersDto,
  ): Promise<RecipientListWithMembers> {
    return this.service.addMembers(membership.accountId, user.id, id, dto);
  }

  @Delete(":id/members/:recipientId")
  @HttpCode(204)
  removeMember(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("recipientId", ParseUUIDPipe) recipientId: string,
  ): Promise<void> {
    return this.service.removeMember(membership.accountId, user.id, id, recipientId);
  }
}
