import { ApiPropertyOptional } from "@nestjs/swagger";
import { RecipientStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class ListRecipientsQueryDto {
  @ApiPropertyOptional({ enum: RecipientStatus })
  @IsOptional()
  @IsEnum(RecipientStatus)
  status?: RecipientStatus;

  @ApiPropertyOptional({ description: "Matches against first or last name" })
  @IsOptional()
  @IsString()
  search?: string;

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
