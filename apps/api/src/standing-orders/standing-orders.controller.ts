import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { StandingOrder } from "@kudos/shared-types";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import { StandingOrdersService } from "./standing-orders.service";
import { SaveStandingOrderDto } from "./dto/save-standing-order.dto";

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
  constructor(private readonly standingOrders: StandingOrdersService) {}

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
}
