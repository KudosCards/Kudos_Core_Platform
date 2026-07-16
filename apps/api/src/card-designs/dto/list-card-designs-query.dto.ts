import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class ListCardDesignsQueryDto {
  @ApiPropertyOptional({ description: "Matches CardDesign.category exactly" })
  @IsOptional()
  @IsString()
  category?: string;
}
