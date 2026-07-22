import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Public } from "../auth/public.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/types";
import type { SafeAccount } from "../accounts/accounts.service";
import { GuestOrdersService, type GuestCheckoutResult } from "./guest-orders.service";
import { GuestClaimService } from "./guest-claim.service";
import { GuestCheckoutDto } from "./dto/guest-checkout.dto";
import { GuestCartCheckoutDto } from "./dto/guest-cart-checkout.dto";
import { ClaimAccountDto } from "./dto/claim-account.dto";

@ApiTags("guest")
@Controller("guest")
export class GuestController {
  constructor(
    private readonly guestOrders: GuestOrdersService,
    private readonly guestClaim: GuestClaimService,
  ) {}

  /**
   * Public, unauthenticated one-off purchase. @Public() exempts it from the
   * global JwtAuthGuard; ThrottlerGuard + @Throttle cap it at 10 orders/minute
   * per IP so it can't be used to spam guest accounts / Stripe sessions (each
   * call mints an account and a real Checkout Session). See docs/adr/0025.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("checkout")
  checkout(@Body() dto: GuestCheckoutDto): Promise<GuestCheckoutResult> {
    return this.guestOrders.checkout(dto);
  }

  /**
   * Public, unauthenticated basket checkout — several personalised cards bought
   * and sent in one payment. Same @Public() + throttle rationale as the
   * single-card checkout above (each call mints one account + one Checkout
   * Session, whatever the basket size). See docs/adr/0025.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("cart-checkout")
  cartCheckout(@Body() dto: GuestCartCheckoutDto): Promise<GuestCheckoutResult> {
    return this.guestOrders.checkoutCart(dto);
  }

  /** Public prefill for the claim form — returns the email a token is tied to. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get("claim/:token")
  claimInfo(@Param("token") token: string): Promise<{ email: string }> {
    return this.guestClaim.getInfo(token);
  }

  /**
   * Attach the authenticated user to the guest account behind the token. NOT
   * @Public — the global JwtAuthGuard supplies the confirmed Supabase user whose
   * email must match the order's.
   */
  @ApiBearerAuth()
  @Post("claim")
  claim(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClaimAccountDto,
  ): Promise<SafeAccount> {
    return this.guestClaim.claim(user, dto.claimToken);
  }
}
