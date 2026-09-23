import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { MESSAGE_DRAFT_BRIEF_MAX_LENGTH } from "@kudos/shared-types";

export class DraftMessagesDto {
  @ApiPropertyOptional({
    description:
      "A short note about the tone or the business, in the subscriber's words. The only free text that leaves the platform.",
    maxLength: MESSAGE_DRAFT_BRIEF_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MESSAGE_DRAFT_BRIEF_MAX_LENGTH)
  brief?: string;
}
