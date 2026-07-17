import { ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionStatus, OccasionType } from "@prisma/client";
import { IsDateString, IsEnum, IsOptional, IsString } from "class-validator";

export class ListOccasionsQueryDto {
  @ApiPropertyOptional({ enum: OccasionStatus })
  @IsOptional()
  @IsEnum(OccasionStatus)
  status?: OccasionStatus;

  @ApiPropertyOptional({ enum: OccasionType })
  @IsOptional()
  @IsEnum(OccasionType)
  type?: OccasionType;

  @ApiPropertyOptional({ description: "ISO date — only occasions on/after this date" })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: "ISO date — only occasions on/before this date" })
  @IsOptional()
  @IsDateString()
  to?: string;

  // Raw query strings, coerced in the service — see common/pagination.ts.
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @IsString()
  perPage?: string;
}
