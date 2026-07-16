import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUrl, Length, ValidateIf } from "class-validator";

/**
 * Every field is independently clearable: passing `null` removes that piece of
 * content, omitting it leaves it unchanged. `ValidateIf(value !== null)` lets a
 * null through the string/url validators so "clear this field" is expressible.
 */
export class UpdateMessagePageDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, 2000)
  message?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, 8)
  emoji?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl()
  videoUrl?: string | null;
}
