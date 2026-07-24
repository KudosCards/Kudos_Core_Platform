import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * A postal address supplied during recovery — either the corrected recipient
 * address (Update Address) or the business address for hand delivery. Same
 * shape as the recipient/shipping address fields elsewhere.
 */
export class RecoveryAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  addressCity!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  addressPostcode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  addressCountry?: string;
}
