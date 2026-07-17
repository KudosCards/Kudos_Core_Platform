import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DispatchOption, PostageClass } from "@prisma/client";
import { IsEnum, IsOptional, IsUUID } from "class-validator";

export class ApproveOccasionDto {
  @ApiProperty()
  @IsUUID()
  savedDesignId!: string;

  /**
   * `asap` (default) leaves the occasion for manual checkout; `auto_send` opts
   * it into the hands-off cron. Auto-send requires the plan's autoSendEnabled
   * entitlement and a complete recipient address (both enforced in the service).
   */
  @ApiPropertyOptional({ enum: DispatchOption })
  @IsOptional()
  @IsEnum(DispatchOption)
  dispatchOption?: DispatchOption;

  /** Postage class for an auto_send occasion — drives stamp cost + dispatch timing. */
  @ApiPropertyOptional({ enum: PostageClass })
  @IsOptional()
  @IsEnum(PostageClass)
  postageClass?: PostageClass;
}
