import { notFound } from "next/navigation";
import type { BatchOrderDetail, WalletSummary } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { OrderDetailClient } from "./order-detail-client";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The order and the wallet balance are independent, so fetch them in one
  // parallel round-trip rather than two serial ones (see docs/adr/0042). The
  // order's 404 becomes null → notFound(); the wallet is only wasted then.
  const [order, wallet] = await Promise.all([
    serverApiFetch<BatchOrderDetail>(`/batch-orders/${id}`).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    serverApiFetch<WalletSummary>("/wallet").catch(() => null),
  ]);
  if (!order) {
    notFound();
  }

  return <OrderDetailClient order={order} walletBalanceMinor={wallet?.balanceMinor ?? 0} />;
}
