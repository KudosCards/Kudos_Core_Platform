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
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const status: FulfillmentStatus = VALID_STATUSES.includes(statusParam as FulfillmentStatus)
    ? (statusParam as FulfillmentStatus)
    : "pending";

  const result = await serverApiFetch<Paginated<FulfillmentJob>>(
    `/fulfillment/jobs?status=${status}&perPage=100`,
  );

  return <FulfillmentClient initialJobs={result?.items ?? []} status={status} />;
}
