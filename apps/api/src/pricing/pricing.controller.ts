import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AccountPricing } from "@kudos/shared-types";
import { VAT_RATE_PERCENT } from "@kudos/shared-types";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import { EntitlementsService } from "../entitlements/entitlements.service";
import {
  CARD_PRICE_MINOR,
  POSTAGE_MINOR,
  computeCardPriceMinor,
} from "../billing/billing.constants";

/**
 * The account's live per-card pricing, so the checkout can show an exact,
 * itemised estimate before payment (the plan discount is applied here, not
 * guessed client-side). See docs/adr/0060-pricing-breakdown.md.
 */
@ApiTags("pricing")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("pricing")
export class PricingController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get()
  async pricing(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<AccountPricing> {
    const entitlement = await this.entitlements.getForAccount(membership.accountId);
    const cardDiscountPercent = Number(entitlement.cardDiscountPercent);
    return {
      cardPriceMinor: computeCardPriceMinor(entitlement.cardDiscountPercent),
      cardDiscountPercent,
      fullCardPriceMinor: CARD_PRICE_MINOR,
      postageMinor: POSTAGE_MINOR,
      vatRatePercent: VAT_RATE_PERCENT,
    };
  }
}
