import { ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { RecipientStatus } from "@prisma/client";
import { IsEnum, IsOptional } from "class-validator";
import { CreateRecipientDto } from "./create-recipient.dto";

export class UpdateRecipientDto extends PartialType(CreateRecipientDto) {
  /** Lets the UI restore an archived recipient (status → active) or re-archive,
   * alongside editing their details. Archiving is also available via DELETE. */
  @ApiPropertyOptional({ enum: RecipientStatus })
  @IsOptional()
  @IsEnum(RecipientStatus)
  status?: RecipientStatus;
}
