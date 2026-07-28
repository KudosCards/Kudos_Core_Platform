import { IsIn, IsOptional, IsString, Length } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { SUPPORT_CATEGORIES, type SupportCategoryValue } from "./support-enums";

/** A subscriber raises a ticket: subject + category + the opening message. */
export class CreateSupportTicketDto {
  @IsString()
  @Length(3, 150)
  subject!: string;

  @IsOptional()
  @ApiProperty({ enum: SUPPORT_CATEGORIES, required: false })
  @IsIn(SUPPORT_CATEGORIES)
  category?: SupportCategoryValue;

  @IsString()
  @Length(1, 5000)
  message!: string;
}
