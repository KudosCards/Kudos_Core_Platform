import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, ValidateIf } from "class-validator";

/**
 * Manually place (or reset) a card's dispatch date — the day Kudos HQ posts it.
 * A concrete ISO date pins it (dragged on the calendar); `null` resets it to the
 * working-day calculation from the occasion date. See docs/adr/0058-drag-dispatch.md.
 */
export class SetDispatchDateDto {
  @ApiProperty({
    nullable: true,
    description: "ISO date to pin dispatch to, or null to reset to the calculated date",
  })
  @ValidateIf((o: SetDispatchDateDto) => o.dispatchDate !== null)
  @IsDateString()
  dispatchDate!: string | null;
}
