import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Best-effort browser context captured silently at ticket creation, for ops
 * triage only. Every field optional — capture must never block submission.
 * See ADR 0079.
 */
export class SupportDiagnosticsDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  viewport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  plan?: string;
}
