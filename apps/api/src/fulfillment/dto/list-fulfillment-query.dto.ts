import { ApiPropertyOptional } from "@nestjs/swagger";
import { FulfillmentJobStatus } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, Matches } from "class-validator";
import {
  DUE_FILTERS,
  HELD_FILTERS,
  QUEUE_SORTS,
  type DueFilter,
  type HeldFilter,
  type QueueSort,
} from "@kudos/shared-types";

// The filter lists live in shared-types, where the web reads them too. They used
// to be declared here as well, so the validator that accepts a value and the UI
// that offers it were two lists that happened to agree.

export class ListFulfillmentQueryDto {
  @ApiPropertyOptional({ enum: FulfillmentJobStatus, default: FulfillmentJobStatus.pending })
  @IsOptional()
  @IsEnum(FulfillmentJobStatus)
  status?: FulfillmentJobStatus;

  @ApiPropertyOptional({ enum: DUE_FILTERS, default: "all" })
  @IsOptional()
  @IsIn(DUE_FILTERS)
  due?: DueFilter;

  /** Exact posting-deadline day (YYYY-MM-DD) — the dispatch-calendar drill-in.
   * Takes precedence over the `due` bucket when set. See ADR 0110. */
  @ApiPropertyOptional({ example: "2026-08-12" })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "dueOn must be an ISO date (YYYY-MM-DD)" })
  dueOn?: string;

  @ApiPropertyOptional({
    enum: HELD_FILTERS,
    description:
      "Narrow to the cards refused because they are addressed to somewhere a card already came back from (`only`), or take them out of the working queue (`hide`). Spans every open status, like the deadline filters.",
  })
  @IsOptional()
  @IsIn(HELD_FILTERS)
  held?: HeldFilter;

  @ApiPropertyOptional({ enum: QUEUE_SORTS, default: "due_date" })
  @IsOptional()
  @IsIn(QUEUE_SORTS)
  sort?: QueueSort;

  // Raw query strings, coerced in the service — see common/pagination.ts.
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsString()
  perPage?: string;
}
