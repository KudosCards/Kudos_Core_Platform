import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType, PostageClass } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { UK_POSTCODE_REGEX } from "../../common/uk-postcode";

/**
 * The largest guest basket we'll take in one payment. Matches the free plan's
 * `batchOrderMaxSize` (see prisma/seed.ts) — the minted guest account is on the
 * free plan, so `BatchOrdersService.create` would reject anything larger anyway;
 * validating here gives the caller a clean 400 instead of a 403 deep in the
 * money path.
 */
export const GUEST_CART_MAX_ITEMS = 20;

/**
 * One personalised card in a guest basket: a card design + its personalisation
 * + the single recipient it's posted to. Mirrors {@link GuestCheckoutDto} minus
 * the buyer email (which is per-basket, not per-card).
 */
export class GuestCartItemDto {
  @ApiProperty({ description: "The public card design (template) to personalise" })
  @IsUUID()
  cardDesignId!: string;

  @ApiPropertyOptional({
    description: "DesignDocument JSON (see @kudos/shared-types). Omit to use the template unedited.",
  })
  @IsOptional()
  @IsObject()
  document?: Record<string, unknown>;

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

/**
 * A guest basket checkout: an unauthenticated visitor buys and sends several
 * personalised cards in one payment, with no account. The API mints a single
 * guest account server-side and builds one batch order across every item.
 * Deliberately carries NO accountId (a public endpoint must never let the caller
 * aim an order at an existing account). See docs/adr/0025.
 */
export class GuestCartCheckoutDto {
  @ApiProperty({ description: "The buyer's email — for the receipt and the account-claim link" })
  @IsEmail()
  buyerEmail!: string;

  @ApiProperty({ type: [GuestCartItemDto], description: "The cards in the basket (1..20)" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(GUEST_CART_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => GuestCartItemDto)
  items!: GuestCartItemDto[];
}
