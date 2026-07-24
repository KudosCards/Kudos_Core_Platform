import { IsIn, IsUUID } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/** The reasons Royal Mail returns a card, mirrored from the ReturnReason enum
 * (schema.prisma) — kept in sync manually, same convention as the other enums. */
export const RETURN_REASONS = [
  "moved",
  "incomplete_address",
  "incorrect_address",
  "undeliverable",
  "other",
] as const;

export type ReturnReasonValue = (typeof RETURN_REASONS)[number];

/** Ops marks a posted/delivered card Returned to Sender. */
export class MarkReturnedDto {
  /** The fulfillment job for the card that came back. */
  @IsUUID()
  fulfillmentJobId!: string;

  @ApiProperty({ enum: RETURN_REASONS })
  @IsIn(RETURN_REASONS)
  reason!: ReturnReasonValue;
}
