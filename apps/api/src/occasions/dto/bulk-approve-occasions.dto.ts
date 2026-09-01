import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BULK_APPROVE_MAX } from "@kudos/shared-types";
import { DispatchOption, PostageClass } from "@prisma/client";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsUUID } from "class-validator";

/**
 * Approve a set of occasions with **one** design.
 *
 * The same fields as `ApproveOccasionDto` plus the ids, deliberately: a bulk
 * approve is the single approve applied to many, not a second way of approving
 * with its own rules. Anything that would be rejected one at a time is rejected
 * here too, per occasion.
 */
export class BulkApproveOccasionsDto {
  @ApiProperty({ type: [String], maxItems: BULK_APPROVE_MAX })
  @IsArray()
  @ArrayMinSize(1)
  // Bounded to what the approvals page can actually show and tick. See
  // BULK_APPROVE_MAX.
  @ArrayMaxSize(BULK_APPROVE_MAX)
  @IsUUID(undefined, { each: true })
  occasionIds!: string[];

  @ApiProperty()
  @IsUUID()
  savedDesignId!: string;

  /**
   * `asap` (default) leaves each occasion for manual checkout; `auto_send` opts
   * them into the hands-off cron. Auto-send's gates are per occasion — the plan
   * entitlement is account-wide, but a complete postal address is not — so it
   * can succeed for some of a selection and fail for others, which is what the
   * response's `failed` list is for.
   */
  @ApiPropertyOptional({ enum: DispatchOption })
  @IsOptional()
  @IsEnum(DispatchOption)
  dispatchOption?: DispatchOption;

  @ApiPropertyOptional({ enum: PostageClass })
  @IsOptional()
  @IsEnum(PostageClass)
  postageClass?: PostageClass;
}
