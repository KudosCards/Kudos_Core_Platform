import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import type { CheckoutResult } from "../common/checkout-result";
import { SubscriptionsService, type SeatSummary } from "./subscriptions.service";
import { CreateSubscriptionCheckoutDto } from "./dto/create-subscription-checkout.dto";
import { SetSeatsDto } from "./dto/set-seats.dto";

@ApiTags("subscriptions")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post("checkout")
  createCheckout(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSubscriptionCheckoutDto,
  ): Promise<CheckoutResult> {
    return this.subscriptionsService.createCheckout(membership.accountId, user.id, dto);
  }

  /** The account's current seat position (used / limit). Any member may read it. */
  @Get("seats")
  getSeats(@CurrentMembership() membership: CurrentMembershipContext): Promise<SeatSummary> {
    return this.subscriptionsService.getSeatSummary(membership.accountId);
  }

  /** Set the paid extra-seat count (owner/admin). Bumps the Stripe subscription
   * quantity and returns the new seat position. */
  @Post("seats")
  setSeats(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: SetSeatsDto,
  ): Promise<SeatSummary> {
    return this.subscriptionsService.setExtraSeats(
      membership.accountId,
      membership.userId,
      membership.role,
      dto.extraSeats,
    );
  }
}
