import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateIf,
} from "class-validator";
import { MESSAGE_PAGE_LIMITS } from "@kudos/shared-types";

/**
 * Create a message page. Only `title` is required — a page can begin as just a
 * heading. Nullable content fields accept `null` to mean "leave empty"; the
 * video URL and CTA get their deeper validation (embeddable provider, https,
 * label-and-url-together) in the service, which owns the shared helpers.
 */
export class CreateMessagePageDto {
  @ApiProperty({ maxLength: MESSAGE_PAGE_LIMITS.title })
  @IsString()
  @Length(1, MESSAGE_PAGE_LIMITS.title)
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, MESSAGE_PAGE_LIMITS.message)
  message?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, MESSAGE_PAGE_LIMITS.emoji)
  emoji?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl()
  videoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, MESSAGE_PAGE_LIMITS.ctaLabel)
  ctaLabel?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl({ protocols: ["https"], require_protocol: true })
  ctaUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowReplies?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(0, MESSAGE_PAGE_LIMITS.recipientName)
  recipientName?: string | null;
}
