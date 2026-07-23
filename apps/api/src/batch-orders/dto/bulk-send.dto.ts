import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType, PostageClass } from "@prisma/client";
import { ArrayMinSize, ArrayUnique, IsEnum, IsOptional, IsUUID } from "class-validator";

/**
 * Bulk send: pick one saved design and a set of EXISTING contacts, and post the
 * same card to every one of them in a single order (one payment). Unlike
 * QuickSendDto — which creates a brand-new recipient from typed-in details — this
 * pulls each recipient's name and postal address straight off their stored
 * record, so there's nothing to re-key. See docs/adr/0027.
 */
export class BulkSendDto {
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
