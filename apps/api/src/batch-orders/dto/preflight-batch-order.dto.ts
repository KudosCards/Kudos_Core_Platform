import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType, PostageClass } from "@prisma/client";
import { ArrayMinSize, ArrayUnique, IsEnum, IsOptional, IsUUID } from "class-validator";

/**
 * Preflight a bulk send: the same inputs as BulkSendDto (a design + a set of
 * existing contacts + postage), but instead of creating an order it returns a
 * check summary — how many are ready, who needs attention, and the exact price —
 * so the sender can fix issues before paying. See docs/adr/0118.
 */
export class PreflightBatchOrderDto {
  @ApiProperty({ description: "The saved design to send to everyone" })
  @IsUUID()
  savedDesignId!: string;

  @ApiProperty({ type: [String], description: "The recipients (existing contacts) to send to" })
  @IsUUID("4", { each: true })
  @ArrayMinSize(1)
  @ArrayUnique()
  recipientIds!: string[];

  @ApiProperty({ enum: PostageClass })
  @IsEnum(PostageClass)
  postageClass!: PostageClass;

  @ApiPropertyOptional({ enum: OccasionType, description: "Defaults to bespoke_campaign" })
  @IsOptional()
  @IsEnum(OccasionType)
  occasionType?: OccasionType;
}
