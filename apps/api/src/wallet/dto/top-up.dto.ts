import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";
import { TOP_UP_MAX_MINOR, TOP_UP_MIN_MINOR } from "@kudos/shared-types";

/** A wallet top-up amount in pence. Bounded: at least £1, at most £1,000 per
 * top-up (a sane guardrail against fat-finger amounts). The bounds come from
 * shared-types so the form and the validator cannot drift — ADR 0164. */
export class TopUpDto {
  @ApiProperty({ description: "Top-up amount in pence (e.g. 2500 = £25)" })
  @IsInt()
  @Min(TOP_UP_MIN_MINOR)
  @Max(TOP_UP_MAX_MINOR)
  amountMinor!: number;
}
