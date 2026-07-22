import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

/** Body for PATCH /accounts/me/notifications. */
export class UpdateNotificationsDto {
  @ApiProperty({ description: "Whether to email upcoming-birthday reminders" })
  @IsBoolean()
  reminderEmailsEnabled!: boolean;
}
