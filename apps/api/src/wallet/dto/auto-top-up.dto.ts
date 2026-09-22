import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsInt, Max, Min } from "class-validator";
import {
  AUTO_TOP_UP_AMOUNT_MAX_MINOR,
  AUTO_TOP_UP_AMOUNT_MIN_MINOR,
  AUTO_TOP_UP_THRESHOLD_MAX_MINOR,
  AUTO_TOP_UP_THRESHOLD_MIN_MINOR,
} from "../auto-top-up";

/**
 * The standing instruction, set whole rather than field by field: switching it
 * on and choosing the numbers is one decision, and a PATCH that could enable it
 * without saying what it will charge is not a decision anybody made.
 *
 * Saving this also clears any pause — resuming is exactly what a customer does
 * here after fixing their card.
 */
export class AutoTopUpDto {
  @ApiProperty({ description: "Whether to top the wallet up automatically" })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ description: "Charge when the balance falls below this, in pence (£1–£200)" })
  @IsInt()
  @Min(AUTO_TOP_UP_THRESHOLD_MIN_MINOR)
  @Max(AUTO_TOP_UP_THRESHOLD_MAX_MINOR)
  thresholdMinor!: number;

  @ApiProperty({ description: "How much to add each time, in pence (£5–£1,000)" })
  @IsInt()
  @Min(AUTO_TOP_UP_AMOUNT_MIN_MINOR)
  @Max(AUTO_TOP_UP_AMOUNT_MAX_MINOR)
  amountMinor!: number;
}
