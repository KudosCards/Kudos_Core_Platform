import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, IsUUID, Length } from "class-validator";

export class CreateSavedDesignDto {
  @ApiPropertyOptional({
    description:
      "The CardDesign template this is based on. Omit to save a custom design from your own uploaded artwork (requires the customArtworkEnabled entitlement and a document).",
  })
  @IsOptional()
  @IsUUID()
  cardDesignId?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({
    description:
      "DesignDocument JSON (see @kudos/shared-types). Omit to start from the template's document unedited; required when no cardDesignId is given.",
  })
  @IsOptional()
  @IsObject()
  document?: Record<string, unknown>;
}
