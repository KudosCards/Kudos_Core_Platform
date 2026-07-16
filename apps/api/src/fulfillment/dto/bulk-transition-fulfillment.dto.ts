import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";
import { TRANSITIONABLE_STATUSES, type TransitionableStatus } from "./transition-fulfillment.dto";

/**
 * A print/post run processes many cards at once — e.g. "these 40 were all
 * posted today". Bounded at 500 to keep the transaction sane.
 */
export class BulkTransitionFulfillmentDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  jobIds!: string[];

  @ApiProperty({ enum: TRANSITIONABLE_STATUSES })
  @IsIn(TRANSITIONABLE_STATUSES)
  toStatus!: TransitionableStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  trackingReference?: string;
}
