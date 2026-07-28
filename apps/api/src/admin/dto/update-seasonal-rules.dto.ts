import { ApiProperty } from "@nestjs/swagger";
import { IsArray } from "class-validator";

/**
 * The full seasonal dispatch rule set to store. The array's contents are
 * validated against the shared zod schema in DispatchConfigService (single
 * source of truth for the rule shape + bounds), so this DTO only guards the
 * envelope.
 */
export class UpdateSeasonalRulesDto {
  @ApiProperty({ type: [Object], description: "Full seasonal dispatch rule set" })
  @IsArray()
  rules!: unknown[];
}
