import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsDate,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";
import { UK_POSTCODE_REGEX } from "../../common/uk-postcode";

/**
 * A directly-added contact must be mailable — we post physical cards via Royal
 * Mail, so line 1, city, and a valid postcode are required at this DTO layer.
 * This hardens the manual-add path (the Recipients "Add contact" form and the
 * onboarding quick-add). Bulk/programmatic sources — CSV import and CRM/inbound
 * `ingestContacts` — deliberately DON'T go through this DTO and stay
 * import-and-flag, so they're never rejected; anything missing an address is
 * surfaced via the "needs address" flag + worklist. See
 * docs/adr/0067-mandatory-addresses.md.
 */

export class CreateRecipientDto {
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
  @Type(() => Date)
  @IsDate()
  dateOfBirth?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  addressLine1!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  addressLine2?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  addressCity!: string;

  @ApiProperty()
  @IsString()
  @Matches(UK_POSTCODE_REGEX, { message: "addressPostcode must be a valid UK postcode" })
  addressPostcode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: "Key→value custom fields usable as {key} merge tokens on a card",
  })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, string>;
}
