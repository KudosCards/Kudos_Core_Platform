import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, IsUUID, Length } from "class-validator";

export class CreateSavedDesignDto {
  @ApiProperty({ description: "The CardDesign template this is based on" })
  @IsUUID()
  cardDesignId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({
    description:
      "DesignDocument JSON (see @kudos/shared-types). Omit to start from the template's document unedited.",
  })
  @IsOptional()
  @IsObject()
  document?: Record<string, unknown>;
}
