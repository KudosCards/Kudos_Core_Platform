import { ApiPropertyOptional } from "@nestjs/swagger";
import { BatchOrderStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class ListBatchOrdersQueryDto {
  @ApiPropertyOptional({ enum: BatchOrderStatus })
  @IsOptional()
  @IsEnum(BatchOrderStatus)
  status?: BatchOrderStatus;

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
