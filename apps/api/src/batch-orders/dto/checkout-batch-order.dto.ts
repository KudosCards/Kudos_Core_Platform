import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional } from "class-validator";

/**
 * Body for POST /batch-orders/:id/checkout.
 *
 * `resume` is the caller's explicit intent to re-checkout an order that is
 * already `pending_payment` — i.e. a previous Checkout Session was created but
 * the buyer closed Stripe without paying, and they've come back via the
 * "Resume checkout" affordance. It is the only way to mint a fresh session for
 * a `pending_payment` order.
 *
 * A first checkout (the "Pay" button on a draft order) MUST omit this flag.
 * That distinction is what makes concurrent double-submits safe: two racing
 * first-checkouts both lack `resume`, so the loser — which may observe the
 * winner's freshly-set `pending_payment` — is rejected with 409 rather than
 * misread as a resume and sent to Stripe a second time. See
 * docs/adr/0125-checkout-resume-intent.md.
 */
export class CheckoutBatchOrderDto {
  @ApiPropertyOptional({
    description:
      "Explicit intent to resume an abandoned pending_payment order. Omit on a first checkout.",
  })
  @IsOptional()
  @IsBoolean()
  resume?: boolean;
}
