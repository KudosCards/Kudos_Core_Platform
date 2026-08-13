import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from "class-validator";
import { CARD_SIZES, type CardSize } from "@kudos/shared-types";

/**
 * The jobs to render into one print-ready PDF, plus the trim size the operator
 * picked. Same job ceiling as the address export (one run is the unit).
 */
export class RenderPrintRunDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  jobIds!: string[];

  @ApiPropertyOptional({ enum: CARD_SIZES })
  @IsOptional()
  @IsIn(CARD_SIZES)
  size?: CardSize;
}
