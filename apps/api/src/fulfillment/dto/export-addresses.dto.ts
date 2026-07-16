import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";

/** The jobs whose full dispatch addresses to pull for a print run. Bounded at
 * 500 (same ceiling as a bulk transition) since one print run is the unit. */
export class ExportAddressesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  jobIds!: string[];
}
