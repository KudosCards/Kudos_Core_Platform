import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OccasionType, PostageClass } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";
import { UK_POSTCODE_REGEX } from "../../common/uk-postcode";
import { BlankToUndefined } from "../../common/transforms";

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

  @ApiPropertyOptional({
    description:
      "Send to an existing contact from the address book; skips creating a new recipient",
  })
  @IsOptional()
  @IsUUID()
  recipientId?: string;

  @ApiPropertyOptional({
    description:
      "When adding a NEW contact (no recipientId), keep it in the address book. Defaults to true; false creates a hidden one-off. Ignored when recipientId is set.",
  })
  @IsOptional()
  @IsBoolean()
  saveToContacts?: boolean;

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
  @BlankToUndefined()
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

  @ApiPropertyOptional({
    description:
      "A library message page to attach to this card's QR (ADR 0132). Only meaningful when the design carries a QR element; validated to belong to the account.",
  })
  @IsOptional()
  @IsUUID()
  messagePageId?: string;

  @ApiPropertyOptional({
    description:
      "Arrive-by date (YYYY-MM-DD) for a scheduled send — we post it to land around then. Omit to send now.",
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "deliverBy must be an ISO date (YYYY-MM-DD)" })
  deliverBy?: string;
}
