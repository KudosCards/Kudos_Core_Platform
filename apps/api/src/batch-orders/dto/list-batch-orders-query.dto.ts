import { ApiPropertyOptional } from "@nestjs/swagger";
import { BatchOrderStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

export class ListBatchOrdersQueryDto {
  @ApiPropertyOptional({ enum: BatchOrderStatus })
  @IsOptional()
  @IsEnum(BatchOrderStatus)
  status?: BatchOrderStatus;

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
