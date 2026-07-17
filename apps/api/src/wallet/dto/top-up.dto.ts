import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

/** A wallet top-up amount in pence. Bounded: at least £1, at most £1,000 per
 * top-up (a sane guardrail against fat-finger amounts). */
export class TopUpDto {
  @ApiProperty({ description: "Top-up amount in pence (e.g. 2500 = £25)" })
  @IsInt()
  @Min(100)
  @Max(100_000)
  amountMinor!: number;
}
