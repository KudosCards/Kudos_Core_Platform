import { IsOptional, IsString, Length, Matches } from "class-validator";

/** Set a recipient's renewal/anniversary key date (the `type` is a path param). */
export class UpsertKeyDateDto {
  /** yyyy-mm-dd; only the month/day drive the annual recurrence. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a YYYY-MM-DD date" })
  date!: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  label?: string;
}
