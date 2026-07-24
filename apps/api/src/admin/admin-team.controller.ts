import {
  Body,
  Controller,
  Delete,
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
import { SuperAdminGuard } from "../auth/super-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, PlatformAdminContext } from "../auth/types";
import { AdminTeamService, type AdminIdentity, type AdminTeam } from "./admin-team.service";
import { InviteAdminDto, ResendAdminInviteDto, SetAdminRoleDto } from "./dto/admin-team.dto";

/**
 * Operator identity & team management. `/admin/access` provisions a newly
 * signed-in operator from the email allow-list (auth only, no admin guard);
 * everything else requires operator access, and mutations require **super
 * admin**. See docs/adr/0040-admin-auth.md.
 */
@ApiTags("admin-team")
@ApiBearerAuth()
@Controller("admin")
export class AdminTeamController {
  constructor(private readonly adminTeam: AdminTeamService) {}

  /** Called right after admin sign-in: provisions from the allow-list if needed,
   * else 403. Deliberately NOT behind PlatformAdminGuard — it's how a first-time
   * operator becomes one. */
  @Post("access")
  access(@CurrentUser() user: AuthenticatedUser): Promise<AdminIdentity> {
    return this.adminTeam.access(user);
  }

  @Get("me")
  @UseGuards(PlatformAdminGuard)
  me(@CurrentUser() user: AuthenticatedUser): Promise<AdminIdentity> {
    return this.adminTeam.me(user);
  }

  /** Any operator can view the team (the UI gates management by role). */
  @Get("team")
  @UseGuards(PlatformAdminGuard)
  team(@CurrentPlatformAdmin() admin: PlatformAdminContext): Promise<AdminTeam> {
    return this.adminTeam.listTeam(admin.userId);
  }

  @Post("team/invites")
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  async invite(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body() dto: InviteAdminDto,
  ): Promise<AdminTeam> {
    await this.adminTeam.invite(admin.userId, dto.email, dto.role);
    return this.adminTeam.listTeam(admin.userId);
  }

  @Post("team/invites/resend")
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  async resendInvite(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body() dto: ResendAdminInviteDto,
  ): Promise<AdminTeam> {
    await this.adminTeam.resendInvite(dto.email);
    return this.adminTeam.listTeam(admin.userId);
  }

  @Delete("team/invites")
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  async removeInvite(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Query("email") email: string,
  ): Promise<AdminTeam> {
    await this.adminTeam.removeInvite(email);
    return this.adminTeam.listTeam(admin.userId);
  }

  @Patch("team/:userId")
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  async setRole(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: SetAdminRoleDto,
  ): Promise<AdminTeam> {
    await this.adminTeam.setRole(userId, dto.role);
    return this.adminTeam.listTeam(admin.userId);
  }

  @Delete("team/:userId")
  @UseGuards(PlatformAdminGuard, SuperAdminGuard)
  async revoke(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("userId", ParseUUIDPipe) userId: string,
  ): Promise<AdminTeam> {
    await this.adminTeam.revoke(userId);
    return this.adminTeam.listTeam(admin.userId);
  }
}
