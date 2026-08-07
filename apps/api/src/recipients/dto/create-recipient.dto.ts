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
import { BlankToNull } from "../../common/transforms";

/**
 * A directly-added contact carries an address when one's known, but the address
 * is OPTIONAL — a contact can be saved with just a name and completed later.
 * Sending physical cards still needs a full mailable address, but that's enforced
 * at SEND time (bulk-send / quick-send reject any contact without one), not at
 * capture time; addressless contacts are surfaced via the "needs address" flag +
 * worklist so they get chased before a send. This matches the import-and-flag
 * behaviour of the bulk/programmatic sources (CSV import, CRM/inbound
 * `ingestContacts`). A postcode, if given, must still be a valid UK one. See
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

  @ApiPropertyOptional({ description: "Optional — add later; required only to send a card" })
  @BlankToNull()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  addressLine1?: string | null;

  @ApiPropertyOptional()
  @BlankToNull()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  addressLine2?: string | null;

  @ApiPropertyOptional({ description: "Optional — add later; required only to send a card" })
  @BlankToNull()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  addressCity?: string | null;

  @ApiPropertyOptional({ description: "Optional, but must be a valid UK postcode if given" })
  @BlankToNull()
  @IsOptional()
  @IsString()
  @Matches(UK_POSTCODE_REGEX, { message: "addressPostcode must be a valid UK postcode" })
  addressPostcode?: string | null;

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
