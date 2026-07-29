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
 * Address on a directly-added contact: the web Add-Contact form makes line 1,
 * city, and postcode required (with postcode autocomplete) so a manually-added
 * contact is mailable — we post physical cards via Royal Mail. It's kept
 * optional at this DTO layer for now so bulk/programmatic callers (and the
 * import-and-flag path) aren't rejected; anything missing an address is surfaced
 * everywhere via the "needs address" flag + worklist. A follow-up can promote
 * this to a hard API requirement. See docs/adr/0067-mandatory-addresses.md.
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  addressCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(UK_POSTCODE_REGEX, { message: "addressPostcode must be a valid UK postcode" })
  addressPostcode?: string;

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
