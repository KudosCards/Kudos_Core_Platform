import { Body, Controller, Get, Post, Put, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { MessageDrafts, StandingOrder } from "@kudos/shared-types";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import { StandingOrdersService } from "./standing-orders.service";
import { MessageDraftingService } from "./message-drafting.service";
import { SaveStandingOrderDto } from "./dto/save-standing-order.dto";
import { DraftMessagesDto } from "./dto/draft-messages.dto";

/**
 * "Click and forget" — the standing instruction and the permission behind it.
 *
 * Readable on every plan, including Free: the feature is meant to be seen and
 * laid out before it is paid for, so the upgrade prompt lands on somebody who
 * has already chosen their cards. Only switching it on is gated.
 * See docs/adr/0256.
 */
@ApiTags("standing-order")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("standing-order")
export class StandingOrdersController {
  constructor(
    private readonly standingOrders: StandingOrdersService,
    private readonly drafting: MessageDraftingService,
  ) {}

  /** The account's instruction, or the empty one they would start from.
   * Reading never creates a row. */
  @Get()
  get(@CurrentMembership() membership: CurrentMembershipContext): Promise<StandingOrder> {
    return this.standingOrders.get(membership.accountId);
  }

  @Put()
  save(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveStandingOrderDto,
  ): Promise<StandingOrder> {
    return this.standingOrders.save(membership.accountId, user.id, dto);
  }

  /**
   * Suggestions, which nothing stores until the subscriber saves them.
   *
   * Throttled on top of the per-account daily cap the service enforces. The
   * cap is what bounds the bill; this only stops a stuck client holding the
   * button down. It is deliberately loose — the throttler keys on the caller's
   * IP, and a centre whose staff all sit behind one office connection share
   * that key, so a tight limit here would punish the wrong thing.
   *
   * A POST because it costs money and makes an outside call, even though it
   * changes nothing here. See ADR 0263.
   */
  @Post("message-drafts")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async draftMessages(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DraftMessagesDto,
  ): Promise<MessageDrafts> {
    const drafts = await this.drafting.draft(
      membership.accountId,
      user.id,
      dto.brief?.trim() ?? null,
    );
    return { drafts };
  }
}
