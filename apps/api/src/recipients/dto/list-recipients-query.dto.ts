import { ApiPropertyOptional } from "@nestjs/swagger";
import { RecipientStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class ListRecipientsQueryDto {
  @ApiPropertyOptional({ enum: RecipientStatus })
  @IsOptional()
  @IsEnum(RecipientStatus)
  status?: RecipientStatus;

  @ApiPropertyOptional({ description: "Matches against first or last name" })
  @IsOptional()
  @IsString()
  search?: string;

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
