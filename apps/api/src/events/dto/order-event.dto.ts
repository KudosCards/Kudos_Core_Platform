import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DispatchOption, PostageClass } from "@prisma/client";
import { IsEnum, IsOptional, IsUUID } from "class-validator";

/**
 * Send the whole cohort in one go: pick one design (and postage), and every
 * still-unsent member is approved with it, addressed from the contact's own
 * record, and rolled into a single draft order the caller then pays.
 */
export class OrderEventDto {
  @ApiProperty({ description: "The saved design every member card carries" })
  @IsUUID()
  savedDesignId!: string;

  @ApiPropertyOptional({ enum: DispatchOption })
  @IsOptional()
  @IsEnum(DispatchOption)
  dispatchOption?: DispatchOption;

  @ApiPropertyOptional({ enum: PostageClass })
  @IsOptional()
  @IsEnum(PostageClass)
  postageClass?: PostageClass;
}
