import { ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { MessagePageStatus } from "@prisma/client";
import { CreateMessagePageDto } from "./create-message-page.dto";

/**
 * Update a message page. Inherits every field from create as optional — passing
 * `null` clears a nullable field, omitting it leaves it unchanged, and `title`
 * (still length-checked when present) can't be blanked — and adds `status`,
 * which the library uses to archive (soft-delete) or restore a page.
 */
export class UpdateMessagePageDto extends PartialType(CreateMessagePageDto) {
  @ApiPropertyOptional({ enum: MessagePageStatus })
  @IsOptional()
  @IsEnum(MessagePageStatus)
  status?: MessagePageStatus;
}
