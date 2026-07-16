import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

/** Paid plans only — "free" has no Stripe object to check out into. */
export class CreateSubscriptionCheckoutDto {
  @ApiProperty({ enum: ["pro", "centre"] })
  @IsIn(["pro", "centre"])
  planId!: "pro" | "centre";
}
