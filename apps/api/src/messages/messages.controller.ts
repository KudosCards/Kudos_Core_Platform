import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Public } from "../auth/public.decorator";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import {
  MessagesService,
  type AccountMessagePage,
  type PublicMessagePage,
} from "./messages.service";
import { UpdateMessagePageDto } from "./dto/update-message-page.dto";

@ApiTags("messages")
@Controller("messages")
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  /**
   * Public — the QR-code target on a printed card. @Public() exempts it from
   * the global JwtAuthGuard, and ThrottlerGuard + @Throttle rate-limit it
   * (the first genuinely anonymous, arbitrary-input endpoint in this API):
   * 30 requests/minute per IP, enough for a real person refreshing/sharing,
   * far below what slug-enumeration or view-count spam would need.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(":slug")
  view(@Param("slug") slug: string): Promise<PublicMessagePage> {
    return this.messagesService.viewBySlug(slug);
  }

  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Get()
  list(@CurrentMembership() membership: CurrentMembershipContext): Promise<AccountMessagePage[]> {
    return this.messagesService.list(membership.accountId);
  }

  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Patch(":id")
  update(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateMessagePageDto,
  ): Promise<AccountMessagePage> {
    return this.messagesService.update(membership.accountId, id, dto);
  }
}
