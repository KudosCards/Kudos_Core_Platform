import { IsIn, IsOptional, IsString } from "class-validator";

export const RETURN_CASE_STATUSES = [
  "awaiting_address",
  "awaiting_resend",
  "resolved",
  "archived",
] as const;

/** Ops RTS queue filter. Omit `status` for the default "open cases" view
 * (awaiting_address + awaiting_resend). */
export class ListReturnsQueryDto {
  @IsOptional()
  @IsIn([...RETURN_CASE_STATUSES, "open"])
  status?: (typeof RETURN_CASE_STATUSES)[number] | "open";

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  perPage?: string;
}
