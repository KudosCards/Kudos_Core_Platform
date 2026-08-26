import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Length, Matches } from "class-validator";

/**
 * A hand-set plan, applied by Kudos HQ rather than bought through Stripe.
 *
 * No `requestId`, unlike AdjustWalletDto. A wallet adjustment is additive, so a
 * double-submit credits twice and needs an idempotency key; setting a plan is
 * idempotent by nature — applying "pro" twice leaves the account on "pro".
 */
export class SetPlanDto {
  @ApiProperty({
    description:
      'The plan to move the account onto — must be a configured plan ("free", "pro", "centre", …). Validated against PlanEntitlement rather than a fixed list, so a plan added later works without a code change.',
  })
  @IsString()
  @IsNotEmpty()
  @Length(2, 40)
  @Matches(/^[a-z0-9_-]+$/, {
    message: "planId must be lowercase letters, numbers, hyphens or underscores",
  })
  planId!: string;

  @ApiProperty({
    description:
      "Why the plan was set by hand. Recorded in the audit trail — this grants paid entitlements with no payment behind them, so the reason is the record that makes it defensible.",
  })
  @IsString()
  @IsNotEmpty()
  @Length(4, 200)
  reason!: string;
}
