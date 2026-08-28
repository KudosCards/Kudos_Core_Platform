import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType } from "@prisma/client";
import { IsEnum, IsOptional, Matches } from "class-validator";

/**
 * The window a calendar view is showing.
 *
 * Both ends are required, unlike the optional `from`/`to` on
 * ListOccasionsQueryDto. This read returns its whole range rather than a page of
 * it, so an open-ended range would be an unbounded query — and a calendar always
 * knows both ends of the window it is drawing.
 */
export class CalendarRangeQueryDto {
  @ApiProperty({ example: "2026-08-31", description: "First day of the window, inclusive." })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "from must be an ISO date (YYYY-MM-DD)" })
  from!: string;

  @ApiProperty({ example: "2026-11-30", description: "Last day of the window, inclusive." })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "to must be an ISO date (YYYY-MM-DD)" })
  to!: string;

  /** The calendar's "All occasions" dropdown. Omitted means all of them. */
  @ApiPropertyOptional({ enum: OccasionType })
  @IsOptional()
  @IsEnum(OccasionType)
  type?: OccasionType;
}
