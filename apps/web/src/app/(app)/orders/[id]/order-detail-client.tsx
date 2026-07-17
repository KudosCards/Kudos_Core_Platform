"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { BatchOrder } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import {
  ORDER_RECIPIENT_STATUS_LABELS,
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  formatGbp,
  formatOrderDate,
  isPayable,
} from "@/lib/orders";

export function OrderDetailClient({
  order,
  walletBalanceMinor,
}: {
  order: BatchOrder;
  walletBalanceMinor: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const payable = isPayable(order.status);
  const canWalletPay = order.status === "draft" && walletBalanceMinor >= order.totalMinor;

  async function payByCard() {
    setError(null);
    setPending("card");
    try {
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>(
        `/batch-orders/${order.id}/checkout`,
        { method: "POST" },
      );
      window.location.assign(checkoutUrl);
    } catch (payError) {
      setError(payError instanceof ApiError ? payError.message : "Could not start checkout");
      setPending(null);
    }
  }

  async function payWithWallet() {
    setError(null);
    setPending("wallet");
    try {
      await clientApiFetch(`/wallet/pay/${order.id}`, { method: "POST" });
      router.refresh();
    } catch (payError) {
      setError(payError instanceof ApiError ? payError.message : "Could not pay from wallet");
      setPending(null);
    }
  }

  async function cancelOrder() {
    setError(null);
    setPending("cancel");
    try {
      await clientApiFetch(`/batch-orders/${order.id}/cancel`, { method: "POST" });
      router.refresh();
    } catch (cancelError) {
      setError(cancelError instanceof ApiError ? cancelError.message : "Could not cancel order");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/orders" className="text-sm text-foreground/60 hover:underline">
          ← Orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {order.orderRecipients.length} card{order.orderRecipients.length === 1 ? "" : "s"}
          </h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${ORDER_STATUS_CLASSES[order.status]}`}
          >
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </div>
        <p className="text-sm text-foreground/50">Ordered {formatOrderDate(order.createdAt)}</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-2 rounded-lg border border-black/10 p-5 text-sm dark:border-white/10">
        <div className="flex justify-between">
          <span className="text-foreground/60">Cards</span>
          <span>{formatGbp(order.subtotalMinor)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-foreground/60">Postage</span>
          <span>{formatGbp(order.postageMinor)}</span>
        </div>
        <div className="flex justify-between border-t border-black/5 pt-2 font-medium dark:border-white/5">
          <span>Total</span>
          <span>{formatGbp(order.totalMinor)}</span>
        </div>
        {order.paymentMethod && (
          <div className="flex justify-between text-foreground/50">
            <span>Paid with</span>
            <span>{order.paymentMethod === "wallet" ? "Wallet" : "Card"}</span>
          </div>
        )}
      </div>

      {payable && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm text-foreground/70">
            This order hasn&apos;t been paid yet. Pay to send it to production, or cancel to release
            its cards back to Approvals.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void payByCard()}
              className="rounded-full bg-foreground px-4 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
            >
              {pending === "card" ? "Redirecting…" : "Pay by card"}
            </button>
            {order.status === "draft" && (
              <button
                type="button"
                disabled={pending !== null || !canWalletPay}
                onClick={() => void payWithWallet()}
                title={canWalletPay ? undefined : "Not enough wallet balance — top up first"}
                className="rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
              >
                {pending === "wallet" ? "Paying…" : "Pay with wallet"}
              </button>
            )}
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void cancelOrder()}
              className="rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
            >
              {pending === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Cards in this order</h2>
        <div className="flex flex-col divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
          {order.orderRecipients.map((line) => (
            <div key={line.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div className="flex flex-col">
                <span>
                  {line.shippingAddressCity}, {line.shippingAddressPostcode}
                </span>
                <span className="text-xs text-foreground/50">
                  {line.postageClass === "first_class" ? "First class" : "Second class"} ·{" "}
                  {formatGbp(line.priceMinor + line.postageMinor)}
                </span>
              </div>
              <span className="text-xs text-foreground/60">
                {ORDER_RECIPIENT_STATUS_LABELS[line.status]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
