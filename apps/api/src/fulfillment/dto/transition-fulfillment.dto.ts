import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length } from "class-validator";

/** The statuses an operator can transition a job *to* via the API. `pending`
 * (creation) and `in_progress` (claim) are set by other flows, not here. */
export const TRANSITIONABLE_STATUSES = ["printed", "posted", "delivered", "failed"] as const;
export type TransitionableStatus = (typeof TRANSITIONABLE_STATUSES)[number];

export class TransitionFulfillmentDto {
  @ApiProperty({ enum: TRANSITIONABLE_STATUSES })
  @IsIn(TRANSITIONABLE_STATUSES)
  toStatus!: TransitionableStatus;

  @ApiPropertyOptional({ description: "Carrier tracking reference, when moving to posted" })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  trackingReference?: string;

  @ApiPropertyOptional({ description: "Why the job failed, recorded in the audit trail" })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  failureReason?: string;
}
