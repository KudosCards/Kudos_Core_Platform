import { IsIn, IsOptional, IsString } from "class-validator";

const STATUSES = ["new", "in_progress", "closed", "spam"] as const;

/** Ops filter for the Enterprise leads queue. Omit `status` (or pass "open") for
 * the default "needs attention" view — newest first, and neither closed nor
 * caught by the spam gate. Pass "spam" to review what the gate caught. */
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
