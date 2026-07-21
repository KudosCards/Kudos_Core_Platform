import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType } from "@prisma/client";
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

/**
 * Adds a hand-curated calendar event to a specific recipient (e.g. a
 * graduation or the end of exams). Created as a `scheduled` occasion: it shows
 * on the calendar straight away but stays out of the approvals queue until the
 * subscriber chooses to prepare a card for it. See
 * docs/adr/0016-recipient-events-and-lists.md.
 */
export class CreateRecipientEventDto {
  @ApiProperty({ description: "The recipient this event belongs to" })
  @IsUUID()
  recipientId!: string;

  @ApiProperty({ enum: OccasionType, description: "Broad category driving the card range" })
  @IsEnum(OccasionType)
  type!: OccasionType;

  @ApiPropertyOptional({ description: 'Human label, e.g. "Graduation" or "End of exams"' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiProperty({ description: "ISO date the event falls on, e.g. 2026-07-15" })
  @IsDateString()
  occasionDate!: string;
}
