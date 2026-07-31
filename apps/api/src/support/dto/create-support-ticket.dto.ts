import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import { SUPPORT_MAX_ATTACHMENTS } from "@kudos/shared-types";
import { SUPPORT_CATEGORIES, type SupportCategoryValue } from "./support-enums";
import { SupportAttachmentInputDto } from "./support-attachment.dto";
import { SupportDiagnosticsDto } from "./support-diagnostics.dto";

/** A subscriber raises a ticket: subject + category + the opening message,
 * optionally with attachments (screenshots/recordings) and diagnostics. */
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SUPPORT_MAX_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => SupportAttachmentInputDto)
  attachments?: SupportAttachmentInputDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SupportDiagnosticsDto)
  diagnostics?: SupportDiagnosticsDto;
}
