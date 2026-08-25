import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString, IsUUID, Length, Max, Min, NotEquals } from "class-validator";

/**
 * A hand-applied wallet credit or debit.
 *
 * Bounded at £1,000 either way, matching the customer-facing top-up guardrail:
 * the amounts this is for are goodwill gestures, and a slipped decimal on an
 * unbounded field is the failure that costs real money.
 */
export class AdjustWalletDto {
  @ApiProperty({
    description:
      "Amount in pence. Positive credits the customer, negative takes it back. A debit is refused if it would take the balance below zero.",
  })
  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  @NotEquals(0)
  amountMinor!: number;

  @ApiProperty({
    description:
      "Why this adjustment was made. Recorded in the audit trail — this moves money with no payment behind it, so the reason is the record that makes it defensible.",
  })
  @IsString()
  @IsNotEmpty()
  @Length(4, 200)
  reason!: string;

  @ApiProperty({
    description:
      "A client-generated id for this attempt, so a retried or double-submitted request credits once rather than twice.",
  })
  @IsUUID()
  requestId!: string;
}
