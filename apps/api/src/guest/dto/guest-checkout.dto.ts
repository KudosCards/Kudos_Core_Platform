import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType, PostageClass } from "@prisma/client";
import {
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";
import { UK_POSTCODE_REGEX } from "../../common/uk-postcode";

/**
 * A guest one-off purchase: an unauthenticated visitor buys and sends a single
 * personalised card. No account is required — the API mints a guest account
 * server-side. Deliberately carries NO accountId: a public endpoint must never
 * let the caller point an order at an existing account. See docs/adr/0025.
 */
export class GuestCheckoutDto {
  @ApiProperty({ description: "The public card design (template) to personalise" })
  @IsUUID()
  cardDesignId!: string;

  @ApiPropertyOptional({
    description: "DesignDocument JSON (see @kudos/shared-types). Omit to use the template unedited.",
  })
  @IsOptional()
  @IsObject()
  document?: Record<string, unknown>;

  @ApiProperty({ description: "The buyer's email — for the receipt and the account-claim link" })
  @IsEmail()
  buyerEmail!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  recipientFirstName!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  recipientLastName!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  shippingAddressLine1!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  shippingAddressLine2?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  shippingAddressCity!: string;

  @ApiProperty()
  @Matches(UK_POSTCODE_REGEX, { message: "shippingAddressPostcode must be a valid UK postcode" })
  shippingAddressPostcode!: string;

  @ApiPropertyOptional({ enum: PostageClass, description: "Defaults to second class" })
  @IsOptional()
  @IsEnum(PostageClass)
  postageClass?: PostageClass;

  @ApiPropertyOptional({ enum: OccasionType, description: "Defaults to bespoke_campaign" })
  @IsOptional()
  @IsEnum(OccasionType)
  occasionType?: OccasionType;
}
