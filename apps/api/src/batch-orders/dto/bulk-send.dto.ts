import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType, PostageClass } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayUnique,
  IsEnum,
  IsOptional,
  IsUUID,
  Matches,
  ValidateNested,
} from "class-validator";

/**
 * One "mark this occasion as handled" instruction: when sending to an
 * occasion-mode segment, the recipient's matched natural occasion (e.g. their
 * birthday this month) is consumed at payment settlement so it can't also fire
 * from approvals/auto-send. See docs/adr/0107-occasion-reconciliation.md.
 */
export class BulkSendReconcileDto {
  @ApiProperty()
  @IsUUID()
  recipientId!: string;

  @ApiProperty()
  @IsUUID()
  occasionId!: string;
}

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

  @ApiPropertyOptional({
    description:
      "Arrive-by date (YYYY-MM-DD) for a scheduled send — we post it to land around then. Omit to send now.",
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "deliverBy must be an ISO date (YYYY-MM-DD)" })
  deliverBy?: string;

  @ApiPropertyOptional({
    type: [BulkSendReconcileDto],
    description:
      "Natural occasions to mark handled (consumed at payment) so a segment send doesn't double-send. Entries for recipients not in recipientIds are ignored.",
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BulkSendReconcileDto)
  reconcile?: BulkSendReconcileDto[];
}
