import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType } from "@prisma/client";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

/**
 * Create a shared event and its initial cohort — one card sent to many
 * contacts on the same date (End of Year, Results Day). Each contact becomes a
 * `scheduled` member occasion. See docs/adr/0057-shared-events.md.
 */
export class CreateEventDto {
  @ApiProperty({ description: 'Human title, e.g. "End of Year 2026"' })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ enum: OccasionType, description: "Broad category driving the card range + colour" })
  @IsEnum(OccasionType)
  type!: OccasionType;

  @ApiProperty({ description: "ISO date the event falls on, e.g. 2026-07-17" })
  @IsDateString()
  eventDate!: string;

  @ApiPropertyOptional({ description: "Optional organiser note (not printed)" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [String], description: "Contacts to attach to the event" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID("4", { each: true })
  recipientIds!: string[];
}
