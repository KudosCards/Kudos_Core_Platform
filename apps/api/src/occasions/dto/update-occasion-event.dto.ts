import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Edits a `scheduled` recipient event (its label or date). Only scheduled
 * events are editable — once an occasion has entered the approval/dispatch
 * pipeline its date is locked to an order. See
 * docs/adr/0016-recipient-events-and-lists.md.
 */
export class UpdateOccasionEventDto {
  @ApiPropertyOptional({ description: 'Human label, e.g. "Graduation"' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ description: "ISO date the event falls on" })
  @IsOptional()
  @IsDateString()
  occasionDate?: string;
}
