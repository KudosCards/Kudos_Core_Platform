import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

const HEALTH_VALUES = ["active", "at_risk", "churned", "none"] as const;

export class ListSubscribersQueryDto {
  @ApiPropertyOptional({ description: "Match account name." })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Filter by plan id (e.g. free, pro, centre)." })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ enum: HEALTH_VALUES })
  @IsOptional()
  @IsIn(HEALTH_VALUES)
  health?: (typeof HEALTH_VALUES)[number];

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
