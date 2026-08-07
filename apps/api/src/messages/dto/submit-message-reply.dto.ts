import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Length, ValidateIf } from "class-validator";
import { MESSAGE_PAGE_LIMITS } from "@kudos/shared-types";

/**
 * A recipient's reply posted from the public message page (Phase 2, ADR 0132).
 * Anonymous input, so it's plain text and length-capped; the name is optional.
 */
export class SubmitMessageReplyDto {
  @ApiPropertyOptional({ nullable: true, maxLength: MESSAGE_PAGE_LIMITS.replySenderName })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, MESSAGE_PAGE_LIMITS.replySenderName)
  senderName?: string | null;

  @ApiProperty({ maxLength: MESSAGE_PAGE_LIMITS.replyBody })
  @IsString()
  @Length(1, MESSAGE_PAGE_LIMITS.replyBody)
  body!: string;
}
