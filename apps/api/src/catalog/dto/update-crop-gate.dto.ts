import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

/**
 * Whether the catalog sync refuses artwork that would be cropped to fit the
 * card. Off until the catalog is re-exported at the card's proportion; on
 * afterwards, so it cannot regress. See docs/card-artwork-shape-plan.md.
 */
export class UpdateCropGateDto {
  @ApiProperty({ description: "Refuse artwork that would be cropped" })
  @IsBoolean()
  enabled!: boolean;
}
