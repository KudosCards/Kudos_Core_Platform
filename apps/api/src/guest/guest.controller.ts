import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Public } from "../auth/public.decorator";
import { GuestOrdersService, type GuestCheckoutResult } from "./guest-orders.service";
import { GuestCheckoutDto } from "./dto/guest-checkout.dto";

@ApiTags("guest")
@Controller("guest")
export class GuestController {
  constructor(private readonly guestOrders: GuestOrdersService) {}

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
}
