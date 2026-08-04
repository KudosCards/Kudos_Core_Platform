import { IsEmail, IsOptional, IsString, Length } from "class-validator";

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
}
