import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import type { CheckoutResult } from "../common/checkout-result";
import { SubscriptionsService } from "./subscriptions.service";
import { CreateSubscriptionCheckoutDto } from "./dto/create-subscription-checkout.dto";

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
}
