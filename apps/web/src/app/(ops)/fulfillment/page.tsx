import type { DueFilter, FulfillmentCounts } from "@kudos/shared-types";
import { DUE_FILTERS } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import {
  FulfillmentClient,
  type FulfillmentJob,
  type FulfillmentStatus,
} from "./fulfillment-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

const VALID_STATUSES: FulfillmentStatus[] = [
  "pending",
  "in_progress",
  "printed",
  "posted",
  "delivered",
  "failed",
];

export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; due?: string }>;
}) {
  const { status: statusParam, due: dueParam } = await searchParams;
  const status: FulfillmentStatus = VALID_STATUSES.includes(statusParam as FulfillmentStatus)
    ? (statusParam as FulfillmentStatus)
    : "pending";
  const due: DueFilter = DUE_FILTERS.includes(dueParam as DueFilter)
    ? (dueParam as DueFilter)
    : "all";

  // The queue defaults to soonest-deadline-first (API default sort), so overdue
  // cards surface at the top even under the "all" filter. See ADR 0108.
  const [result, counts] = await Promise.all([
    serverApiFetch<Paginated<FulfillmentJob>>(
      `/fulfillment/jobs?status=${status}&due=${due}&perPage=100`,
    ),
    serverApiFetch<FulfillmentCounts>("/fulfillment/counts"),
  ]);

  const emptyCounts: FulfillmentCounts = {
    status: {
      pending: 0,
      in_progress: 0,
      printed: 0,
      posted: 0,
      delivered: 0,
      returned_to_sender: 0,
      failed: 0,
    },
    due: { overdue: 0, today: 0, dueSoon: 0, upcoming: 0, noDate: 0 },
    clickAndDropErrors: 0,
  };

  return (
    <FulfillmentClient
      initialJobs={result?.items ?? []}
      status={status}
      due={due}
      counts={counts ?? emptyCounts}
    />
  );
}
