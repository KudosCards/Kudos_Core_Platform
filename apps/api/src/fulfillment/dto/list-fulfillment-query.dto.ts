import { ApiPropertyOptional } from "@nestjs/swagger";
import { FulfillmentJobStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";

export class ListFulfillmentQueryDto {
  @ApiPropertyOptional({ enum: FulfillmentJobStatus, default: FulfillmentJobStatus.pending })
  @IsOptional()
  @IsEnum(FulfillmentJobStatus)
  status?: FulfillmentJobStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage: number = 50;
}
