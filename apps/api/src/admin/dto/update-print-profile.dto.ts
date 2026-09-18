import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNumber, Max, Min } from "class-validator";
import {
  BACK_FOOTER_MODES,
  MAX_BORDERLESS_OVERHANG_MM,
  PRINT_LAYOUTS,
  type BackFooterMode,
  type PrintLayout,
} from "@kudos/shared-types";

/**
 * A new print profile. Both fields are re-validated against the shared
 * `printProfileSchema` in PrintProfileService (single source of truth, and where
 * the overhang is rounded); this DTO only guards the envelope.
 */
export class UpdatePrintProfileDto {
  @ApiProperty({ enum: PRINT_LAYOUTS, description: "How a run is laid out on paper" })
  @IsIn(PRINT_LAYOUTS)
  layout!: PrintLayout;

  @ApiProperty({
    minimum: 0,
    maximum: MAX_BORDERLESS_OVERHANG_MM,
    description: "Long-edge loss from the borderless calibration sheet, in mm (0 = not measured)",
  })
  @IsNumber()
  @Min(0)
  @Max(MAX_BORDERLESS_OVERHANG_MM)
  borderlessOverhangMm!: number;

  @ApiProperty({
    minimum: -MAX_BORDERLESS_OVERHANG_MM,
    maximum: MAX_BORDERLESS_OVERHANG_MM,
    description: "Long-axis placement offset, (left − right) ÷ 2 of the calibration readings",
  })
  @IsNumber()
  @Min(-MAX_BORDERLESS_OVERHANG_MM)
  @Max(MAX_BORDERLESS_OVERHANG_MM)
  borderlessOffsetXMm!: number;

  @ApiProperty({
    minimum: -MAX_BORDERLESS_OVERHANG_MM,
    maximum: MAX_BORDERLESS_OVERHANG_MM,
    description: "Short-axis placement offset, (top − bottom) ÷ 2 of the calibration readings",
  })
  @IsNumber()
  @Min(-MAX_BORDERLESS_OVERHANG_MM)
  @Max(MAX_BORDERLESS_OVERHANG_MM)
  borderlessOffsetYMm!: number;

  @ApiProperty({
    enum: BACK_FOOTER_MODES,
    description: "Whether the back's bottom strip is pre-printed on the stock or drawn by us",
  })
  @IsIn(BACK_FOOTER_MODES)
  backFooter!: BackFooterMode;
}
