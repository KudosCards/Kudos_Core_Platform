import { IsObject, IsOptional, IsString, Length } from "class-validator";

/** Rename a saved segment, change its rule, or both. The definition is
 * validated with zod in the service (a discriminated/optional structure
 * class-validator can't easily express), and "at least one field" is enforced
 * there too, against `updateSegmentInputSchema`. */
export class UpdateSegmentDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsObject()
  definition?: Record<string, unknown>;
}
