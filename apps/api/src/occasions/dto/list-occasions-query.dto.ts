import { ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

export class ListOccasionsQueryDto {
  @ApiPropertyOptional({ enum: OccasionStatus })
  @IsOptional()
  @IsEnum(OccasionStatus)
  status?: OccasionStatus;

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
