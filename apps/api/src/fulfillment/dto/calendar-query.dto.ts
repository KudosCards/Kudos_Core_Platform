import { ApiProperty } from "@nestjs/swagger";
import { Matches } from "class-validator";

/** The date window for the dispatch calendar (inclusive), both ISO YYYY-MM-DD.
 * The service caps how wide a window it will scan. See ADR 0110. */
export class CalendarQueryDto {
  @ApiProperty({ example: "2026-08-01" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "from must be an ISO date (YYYY-MM-DD)" })
  from!: string;

  @ApiProperty({ example: "2026-08-31" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "to must be an ISO date (YYYY-MM-DD)" })
  to!: string;
}
