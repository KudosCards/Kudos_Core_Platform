import { IsIn, IsOptional } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import {
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  type SupportPriorityValue,
  type SupportStatusValue,
} from "./support-enums";

/** Ops ticket management — change status/priority and (un)assign to self. */
export class UpdateSupportTicketDto {
  @IsOptional()
  @ApiProperty({ enum: SUPPORT_STATUSES, required: false })
  @IsIn(SUPPORT_STATUSES)
  status?: SupportStatusValue;

  @IsOptional()
  @ApiProperty({ enum: SUPPORT_PRIORITIES, required: false })
  @IsIn(SUPPORT_PRIORITIES)
  priority?: SupportPriorityValue;

  @IsOptional()
  @ApiProperty({ enum: ["me", "none"], required: false })
  @IsIn(["me", "none"])
  assign?: "me" | "none";
}
