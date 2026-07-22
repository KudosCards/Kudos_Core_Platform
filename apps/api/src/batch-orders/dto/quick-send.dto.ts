import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType, PostageClass } from "@prisma/client";
import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";
import { UK_POSTCODE_REGEX } from "../../common/uk-postcode";

/**
 * The guided "send this card" flow: turn a freshly-designed saved card + a
 * single recipient into a ready-to-pay order in one step. The service creates
 * the recipient, an approved one-off occasion carrying the design, and the
 * draft batch order — then the normal /batch-orders/:id/checkout takes over.
 * See docs/adr/0018-guided-first-order.md.
 */
export class QuickSendDto {
  @ApiProperty({ description: "The saved design to send" })
  @IsUUID()
  savedDesignId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  lastName!: string;

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

  @ApiProperty({ enum: PostageClass })
  @IsEnum(PostageClass)
  postageClass!: PostageClass;

  @ApiPropertyOptional({ enum: OccasionType, description: "Defaults to bespoke_campaign" })
  @IsOptional()
  @IsEnum(OccasionType)
  occasionType?: OccasionType;
}
