import type { AccountPricing, PlanEntitlement, WalletSummary } from "@kudos/shared-types";
import { CARD_PRICE_MINOR, POSTAGE_MINOR, VAT_RATE_PERCENT } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";

/** Safe full-price fallback if the pricing lookup fails — the server is always
 * authoritative at checkout, so this only affects the on-screen estimate. */
const FALLBACK_PRICING: AccountPricing = {
  cardPriceMinor: CARD_PRICE_MINOR,
  cardDiscountPercent: 0,
  fullCardPriceMinor: CARD_PRICE_MINOR,
  postageMinor: POSTAGE_MINOR,
  vatRatePercent: VAT_RATE_PERCENT,
};
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

  const [occasions, orders, wallet, pricing, entitlement] = await Promise.all([
    serverApiFetch<Paginated<OccasionWithRecipient>>("/occasions?status=approved&perPage=50"),
    serverApiFetch<Paginated<UnfinishedBatchOrder>>("/batch-orders?perPage=50"),
    serverApiFetch<WalletSummary>("/wallet"),
    serverApiFetch<AccountPricing>("/pricing"),
    serverApiFetch<PlanEntitlement>("/accounts/me/entitlements"),
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
      pricing={pricing ?? FALLBACK_PRICING}
      maxPerOrder={entitlement?.batchOrderMaxSize ?? 10}
    />
  );
}
