import { Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { UseGuards } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import type { SafeAccount } from "../accounts/accounts.service";
import { TeamService } from "./team.service";

/**
 * The invite-acceptance surface — deliberately NOT behind MembershipGuard,
 * because accepting is how an invited user gets their FIRST membership (mirrors
 * the account signup / guest-claim endpoints).
 */
@ApiTags("invites")
@Controller("invites")
export class InvitesController {
  constructor(private readonly teamService: TeamService) {}

  /** Public preview for the accept page — reveals only what the token holder
   * (the intended invitee) needs to decide. Throttled like the claim preview. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(":token")
  preview(@Param("token") token: string) {
    return this.teamService.previewInvite(token);
  }

  /** Accept an invite. Authenticated (global JwtAuthGuard) but NOT
   * MembershipGuard — this is the moment the invitee joins the account. */
  @ApiBearerAuth()
  @Post(":token/accept")
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param("token") token: string,
  ): Promise<SafeAccount> {
    return this.teamService.acceptInvite(user, token);
  }
}
