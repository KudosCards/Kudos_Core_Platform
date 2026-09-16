import { IsEmail, IsISO8601, IsOptional, IsString, Length } from "class-validator";

/**
 * The public /enterprise "Contact us" submission. Mirrors
 * createEnterpriseEnquirySchema in @kudos/shared-types; bounds every field so an
 * abusive payload is rejected before it reaches the DB or the ops inbox.
 */
export class CreateEnterpriseEnquiryDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsEmail()
  @Length(1, 200)
  email!: string;

  @IsString()
  @Length(1, 160)
  organisation!: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  teamSize?: string;

  @IsString()
  @Length(1, 4000)
  message!: string;

  /**
   * Honeypot — hidden from real visitors, filled in by bots. Declared here
   * because the global ValidationPipe runs `forbidNonWhitelisted`, so an
   * undeclared field would 400 and tell the bot exactly what tripped it.
   * See spam-signals.ts and ADR 0244.
   */
  @IsOptional()
  @IsString()
  @Length(0, 200)
  contactReference?: string;

  /** When the form was rendered, set client-side at mount. Absence is neutral. */
  @IsOptional()
  @IsISO8601()
  formOpenedAt?: string;
}
