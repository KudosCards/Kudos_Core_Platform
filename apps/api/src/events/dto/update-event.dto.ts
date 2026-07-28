import { ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType } from "@prisma/client";
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

/** Edit a shared event's own fields (title/type/date/notes). Membership is
 * managed via the add/remove-member endpoints. */
export class UpdateEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ enum: OccasionType })
  @IsOptional()
  @IsEnum(OccasionType)
  type?: OccasionType;

  @ApiPropertyOptional({ description: "ISO date the event falls on" })
  @IsOptional()
  @IsDateString()
  eventDate?: string;

  @ApiPropertyOptional({ description: "Organiser note; send empty string to clear" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
