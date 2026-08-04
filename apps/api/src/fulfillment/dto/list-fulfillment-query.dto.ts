import { ApiPropertyOptional } from "@nestjs/swagger";
import { FulfillmentJobStatus } from "@prisma/client";
import { IsEnum, IsIn, IsOptional, IsString } from "class-validator";

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
