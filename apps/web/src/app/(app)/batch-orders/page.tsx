import { serverApiFetch } from "@/lib/api.server";
import type { OccasionWithRecipient } from "../approvals/approvals-client";
import { BatchOrdersClient } from "./batch-orders-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function BatchOrdersPage() {
  const occasions = await serverApiFetch<Paginated<OccasionWithRecipient>>(
    "/occasions?status=approved&perPage=50",
  );

  return <BatchOrdersClient initialOccasions={occasions?.items ?? []} />;
}
