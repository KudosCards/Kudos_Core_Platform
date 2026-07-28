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

export default async function BatchOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ occasions?: string }>;
}) {
  // Occasions can arrive pre-selected from the calendar's list-view bulk action
  // (?occasions=id1,id2) so a scattered set can be checked out in one jump.
  const { occasions: preselectParam } = await searchParams;
  const preselectedIds = (preselectParam ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

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

  // Only pre-tick ids that are actually in the approved list we loaded.
  const available = new Set((occasions?.items ?? []).map((o) => o.id));
  const initialSelectedIds = preselectedIds.filter((id) => available.has(id));

  return (
    <BatchOrdersClient
      initialOccasions={occasions?.items ?? []}
      initialUnfinishedOrders={unfinishedOrders}
      walletBalanceMinor={wallet?.balanceMinor ?? 0}
      initialSelectedIds={initialSelectedIds}
    />
  );
}
