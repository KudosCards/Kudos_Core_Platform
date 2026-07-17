import type { WalletSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import type { OccasionWithRecipient } from "../approvals/approvals-client";
import { BatchOrdersClient, type UnfinishedBatchOrder } from "./batch-orders-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function BatchOrdersPage() {
  const [occasions, orders, wallet] = await Promise.all([
    serverApiFetch<Paginated<OccasionWithRecipient>>("/occasions?status=approved&perPage=50"),
    serverApiFetch<Paginated<UnfinishedBatchOrder>>("/batch-orders?perPage=50"),
    serverApiFetch<WalletSummary>("/wallet"),
  ]);

  // No multi-status filter on the list endpoint, so fetch everything recent
  // and filter here — "unfinished" means still holding occasions hostage
  // (queued, not yet paid or released) with no other place in the UI to see it.
  const unfinishedOrders = (orders?.items ?? []).filter(
    (order) => order.status === "draft" || order.status === "pending_payment",
  );

  return (
    <BatchOrdersClient
      initialOccasions={occasions?.items ?? []}
      initialUnfinishedOrders={unfinishedOrders}
      walletBalanceMinor={wallet?.balanceMinor ?? 0}
    />
  );
}
