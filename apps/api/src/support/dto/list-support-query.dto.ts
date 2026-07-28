import { IsIn, IsOptional, IsString } from "class-validator";
import { SUPPORT_STATUSES } from "./support-enums";

/** Ops support-queue filter. Omit `status` (or pass "open") for the default
 * "needs attention" view — everything not yet closed, oldest activity first. */
export class ListSupportQueryDto {
  @IsOptional()
  @IsIn([...SUPPORT_STATUSES, "open"])
  status?: (typeof SUPPORT_STATUSES)[number] | "open";

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  perPage?: string;
}
