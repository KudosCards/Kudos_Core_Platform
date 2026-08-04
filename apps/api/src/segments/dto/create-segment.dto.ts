import { IsObject, IsString, Length } from "class-validator";

/** Save a segment: a name + the SegmentDefinition (validated with zod in the
 * service, since it's a discriminated/optional structure class-validator can't
 * easily express). */
export class CreateSegmentDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsObject()
  definition!: Record<string, unknown>;
}
