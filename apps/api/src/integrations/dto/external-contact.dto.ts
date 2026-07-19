import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, Length, MaxLength } from "class-validator";

/**
 * One inbound contact. Deliberately lenient (see ADR 0015): only a stable id
 * and a name are required; DOB/address are optional and the postcode is not
 * UK-validated, since CRM data varies and a contact with no birthday is still
 * worth importing (it's flagged, not rejected).
 */
export class ExternalContactDto {
  @ApiProperty({ description: "This contact's stable id in your system — the dedupe key." })
  @IsString()
  @Length(1, 200)
  externalId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ description: "ISO date (YYYY-MM-DD) or full ISO timestamp." })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  addressCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  addressPostcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  addressCountry?: string;
}
