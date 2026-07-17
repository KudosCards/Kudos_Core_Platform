import { ApiPropertyOptional } from "@nestjs/swagger";
import { FulfillmentJobStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class ListFulfillmentQueryDto {
  @ApiPropertyOptional({ enum: FulfillmentJobStatus, default: FulfillmentJobStatus.pending })
  @IsOptional()
  @IsEnum(FulfillmentJobStatus)
  status?: FulfillmentJobStatus;

  // Raw query strings, coerced in the service — see common/pagination.ts.
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsString()
  perPage?: string;
}
