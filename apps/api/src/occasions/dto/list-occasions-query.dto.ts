import { ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionStatus, OccasionType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

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

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage: number = 25;
}
