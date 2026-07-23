import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";

/** Sets the account's paid **extra** seat count (beyond the plan's included
 * seats) — an absolute target, not a delta, so the request is idempotent. The
 * upper bound is a sanity cap, not a business limit. */
export class SetSeatsDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  extraSeats!: number;
}
