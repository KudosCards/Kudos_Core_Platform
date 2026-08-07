import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Redirect,
  UseGuards,
} from "@nestjs/common";
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
import { SubmitMessageReplyDto } from "./dto/submit-message-reply.dto";

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

  /**
   * Public — a recipient writes back from the scanned page. Anonymous and
   * arbitrary-input, so it's throttled harder than the read (5/min per IP is
   * ample for a genuine reply, far below what spam would need) on top of the
   * server-side plain-text + length cap.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(":slug/replies")
  @HttpCode(202)
  reply(@Param("slug") slug: string, @Body() dto: SubmitMessageReplyDto): Promise<void> {
    return this.messagesService.submitReply(slug, dto);
  }

  /**
   * Public — the CTA button routes through here so a click is counted before the
   * recipient is 302-redirected to the page's https target (per-card tracking on
   * a shared page). Throttled like the other public routes.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(":slug/cta")
  @Redirect()
  async cta(@Param("slug") slug: string): Promise<{ url: string; statusCode: number }> {
    const url = await this.messagesService.trackCtaClick(slug);
    return { url, statusCode: 302 };
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
