import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { SUPPORT_MAX_ATTACHMENTS } from "@kudos/shared-types";
import { SupportAttachmentInputDto } from "./support-attachment.dto";

/** A subscriber's reply on their own ticket, optionally with attachments. */
export class SupportReplyDto {
  @IsString()
  @Length(1, 5000)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SUPPORT_MAX_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => SupportAttachmentInputDto)
  attachments?: SupportAttachmentInputDto[];
}
