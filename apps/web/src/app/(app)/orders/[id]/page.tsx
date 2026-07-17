import { notFound } from "next/navigation";
import type { BatchOrder, WalletSummary } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { OrderDetailClient } from "./order-detail-client";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await serverApiFetch<BatchOrder>(`/batch-orders/${id}`).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  });
  if (!order) {
    notFound();
  }
  const wallet = await serverApiFetch<WalletSummary>("/wallet").catch(() => null);

  return <OrderDetailClient order={order} walletBalanceMinor={wallet?.balanceMinor ?? 0} />;
}
