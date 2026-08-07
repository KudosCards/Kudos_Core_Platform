import { ApiProperty } from "@nestjs/swagger";
import { Matches } from "class-validator";

/**
 * Reschedule a paid, not-yet-posted order to a new arrive-by date. The server
 * recomputes each card's post-by date from it. See docs/adr/0130-scheduled-sends.md.
 */
export class RescheduleBatchOrderDto {
  @ApiProperty({ description: "New arrive-by date (YYYY-MM-DD)" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "deliverBy must be an ISO date (YYYY-MM-DD)" })
  deliverBy!: string;
}
