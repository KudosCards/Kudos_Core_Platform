import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, Length } from "class-validator";

export class UpdateSavedDesignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ description: "DesignDocument JSON (see @kudos/shared-types)" })
  @IsOptional()
  @IsObject()
  document?: Record<string, unknown>;
}
