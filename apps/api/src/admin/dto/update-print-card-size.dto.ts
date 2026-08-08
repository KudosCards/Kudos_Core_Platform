import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { CARD_SIZES, type CardSize } from "@kudos/shared-types";

/**
 * The new default print size. `size` is re-validated against the shared
 * `cardSizeSchema` in CardSizeConfigService (single source of truth), so this
 * DTO only guards the envelope with the allowed codes.
 */
export class UpdatePrintCardSizeDto {
  @ApiProperty({ enum: CARD_SIZES, description: 'Default print size ("A5" | "A6")' })
  @IsIn(CARD_SIZES)
  size!: CardSize;
}
