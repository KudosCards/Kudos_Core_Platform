import { IsIn, IsOptional, IsString } from "class-validator";

const STATUSES = ["new", "in_progress", "closed"] as const;

/** Ops filter for the Enterprise leads queue. Omit `status` (or pass "open") for
 * the default "needs attention" view — everything not yet closed, newest first. */
export class ListEnterpriseQueryDto {
  @IsOptional()
  @IsIn([...STATUSES, "open"])
  status?: (typeof STATUSES)[number] | "open";

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  perPage?: string;
}
