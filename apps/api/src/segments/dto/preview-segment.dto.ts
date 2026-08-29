import { IsObject } from "class-validator";

/** Resolve a rule that hasn't been saved, so the builder can show a live count
 * while it's still being edited. Shape-checked with zod in the service. */
export class PreviewSegmentDto {
  @IsObject()
  definition!: Record<string, unknown>;
}
