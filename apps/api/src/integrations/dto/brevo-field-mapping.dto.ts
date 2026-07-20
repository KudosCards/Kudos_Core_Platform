import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Which Brevo attribute name feeds each of our fields. All optional — first/last
 * default to Brevo's FIRSTNAME/LASTNAME; the rest are only needed if the account
 * stores DOB/address in custom Brevo attributes.
 */
export class BrevoFieldMappingDto {
  @ApiPropertyOptional({ description: "Brevo attribute for first name (default FIRSTNAME)." })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ description: "Brevo attribute for last name (default LASTNAME)." })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  addressCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  addressPostcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  addressCountry?: string;
}
