import { ApiPropertyOptional } from "@nestjs/swagger";
import { FulfillmentJobStatus } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString, Matches } from "class-validator";

/** Urgency filter over a job's dispatch deadline (due_date). See ADR 0108. */
export const DUE_FILTERS = ["overdue", "today", "due_soon", "upcoming", "no_date", "all"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

/** How the queue is ordered: by dispatch deadline (default) or arrival order. */
export const QUEUE_SORTS = ["due_date", "created_at"] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];

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
