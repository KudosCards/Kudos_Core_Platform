import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsPositive, IsString, IsUrl, MaxLength, MinLength, IsOptional } from "class-validator";

/**
 * Records a just-completed designer upload into the account's reusable-asset
 * library. The browser has already PUT the bytes to the signed URL, so this
 * only persists the resulting public `url` plus display metadata.
 */
export class CreateDesignAssetDto {
  @ApiProperty({ description: "Public storage URL the upload resolved to" })
  @IsUrl()
  url!: string;

  @ApiProperty({ description: "Original file name, for display in the library" })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fileName!: string;

  @ApiPropertyOptional({ description: "Natural pixel width, for aspect-correct insert" })
  @IsOptional()
  @IsInt()
  @IsPositive()
  width?: number;

  @ApiPropertyOptional({ description: "Natural pixel height, for aspect-correct insert" })
  @IsOptional()
  @IsInt()
  @IsPositive()
  height?: number;
}
