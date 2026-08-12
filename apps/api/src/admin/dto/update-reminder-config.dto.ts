import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsInt, Max, Min } from "class-validator";

/**
 * The send-by-5 reminder config to store. The values are re-validated against the
 * shared zod schema in DispatchConfigService (single source of truth), so this DTO
 * only guards types + coarse bounds on the envelope. See docs/adr/0117.
 */
export class UpdateReminderConfigDto {
  @ApiProperty({ description: "Whether the daily reminder runs" })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ description: "UTC hour (0–23) the weekday digest is sent" })
  @IsInt()
  @Min(0)
  @Max(23)
  sendHourUtc!: number;

  @ApiProperty({ description: "The send-by window in working days (the must-ship horizon)" })
  @IsInt()
  @Min(1)
  @Max(15)
  leadWorkingDays!: number;

  @ApiProperty({
    description: "Working days overdue before a card escalates to super admins (0 = off)",
  })
  @IsInt()
  @Min(0)
  @Max(15)
  escalateAfterWorkingDays!: number;

  @ApiProperty({
    description: "Same-day posting cut-off (UK local hour, 0–23): a 'Send now' order at or after it posts the next working day",
  })
  @IsInt()
  @Min(0)
  @Max(23)
  sameDayCutoffHour!: number;
}
