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
import { TeamService, type SafeInvite, type TeamView } from "./team.service";
import { CreateInviteDto } from "./dto/create-invite.dto";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";

@ApiTags("team")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("team")
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  getTeam(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TeamView> {
    return this.teamService.getTeam(membership.accountId, user.id, membership.role);
  }

  @Post("invites")
  createInvite(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInviteDto,
  ): Promise<SafeInvite> {
    return this.teamService.createInvite(membership.accountId, user, membership.role, dto);
  }

  @Post("invites/:id/revoke")
  @HttpCode(204)
  revokeInvite(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.teamService.revokeInvite(membership.accountId, membership.role, id);
  }

  @Delete("members/:userId")
  @HttpCode(204)
  removeMember(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.teamService.removeMember(membership.accountId, membership.role, user.id, userId);
  }

  @Patch("members/:userId/role")
  @HttpCode(204)
  updateMemberRole(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<void> {
    return this.teamService.updateMemberRole(
      membership.accountId,
      membership.role,
      user.id,
      userId,
      dto.role,
    );
  }
}
