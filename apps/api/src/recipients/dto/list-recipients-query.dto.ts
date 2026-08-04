import { ApiPropertyOptional } from "@nestjs/swagger";
import { RecipientStatus } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from "class-validator";

export class ListRecipientsQueryDto {
  @ApiPropertyOptional({
    description: 'Pass "true" to return only contacts without a mailable address',
  })
  @IsOptional()
  @IsIn(["true", "false"])
  missingAddress?: "true" | "false";

  @ApiPropertyOptional({ enum: RecipientStatus })
  @IsOptional()
  @IsEnum(RecipientStatus)
  status?: RecipientStatus;

  @ApiPropertyOptional({ description: "Matches against first or last name" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Birthday month 1–12 (e.g. "8" for August), ignoring year',
  })
  @IsOptional()
  @IsIn(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"])
  birthMonth?: string;

  @ApiPropertyOptional({ description: "Only recipients on this list" })
  @IsOptional()
  @IsUUID()
  listId?: string;

  @ApiPropertyOptional({
    description: 'Filter by where the contact came from (e.g. "manual", "brevo")',
  })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({
    enum: ["recent", "name_asc", "name_desc", "dob_asc", "dob_desc"],
    description: "Column sort; defaults to most-recently-added",
  })
  @IsOptional()
  @IsIn(["recent", "name_asc", "name_desc", "dob_asc", "dob_desc"])
  sort?: "recent" | "name_asc" | "name_desc" | "dob_asc" | "dob_desc";

  // Kept as raw query strings and coerced in the service via parsePage/
  // parsePerPage — NOT class-transformer @Type, which failed in production. See
  // common/pagination.ts.
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @IsString()
  perPage?: string;
}
