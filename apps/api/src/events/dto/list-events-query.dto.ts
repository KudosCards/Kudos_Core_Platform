import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsOptional } from "class-validator";

export class ListEventsQueryDto {
  @ApiPropertyOptional({ description: "ISO date — only events on/after this date" })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: "ISO date — only events on/before this date" })
  @IsOptional()
  @IsDateString()
  to?: string;
}
