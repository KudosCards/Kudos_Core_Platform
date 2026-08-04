"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { BatchOrder } from "@kudos/shared-types";
import { computePricingBreakdown } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { PricingBreakdownCard } from "@/components/pricing-breakdown";
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
        <Link href="/orders" className="text-sm text-muted hover:text-foreground hover:underline">
          ← Orders
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {order.orderRecipients.length} card{order.orderRecipients.length === 1 ? "" : "s"}
          </h1>
          <span className={`pill ${ORDER_STATUS_CLASSES[order.status]}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </div>
        <p className="text-sm text-muted">Ordered {formatOrderDate(order.createdAt)}</p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <div className="card grid gap-2 p-5 text-sm">
        <PricingBreakdownCard
          breakdown={computePricingBreakdown({
            cardCount: order.orderRecipients.length,
            cardSubtotalInclVatMinor: order.subtotalMinor,
            postageMinor: order.postageMinor,
          })}
        />
        {order.paymentMethod && (
          <div className="flex justify-between text-muted">
            <span>Paid with</span>
            <span>{order.paymentMethod === "wallet" ? "Wallet" : "Card"}</span>
          </div>
        )}
        {(order.receiptPdfUrl || order.receiptUrl) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-muted">VAT receipt</span>
            <span className="flex items-center gap-3">
              {order.receiptPdfUrl && (
                <a
                  href={order.receiptPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent hover:underline"
                >
                  Download PDF
                </a>
              )}
              {order.receiptUrl && (
                <a
                  href={order.receiptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-foreground hover:underline"
                >
                  View online
                </a>
              )}
            </span>
          </div>
        )}
      </div>

      {payable && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm text-foreground/80">
            This order hasn&apos;t been paid yet. Pay to send it to production, or cancel to release
            its cards back to Approvals.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void payByCard()}
              className="btn-accent"
            >
              {pending === "card" ? "Redirecting…" : "Pay by card"}
            </button>
            {order.status === "draft" && (
              <button
                type="button"
                disabled={pending !== null || !canWalletPay}
                onClick={() => void payWithWallet()}
                title={canWalletPay ? undefined : "Not enough wallet balance — top up first"}
                className="btn-secondary"
              >
                {pending === "wallet" ? "Paying…" : "Pay with wallet"}
              </button>
            )}
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void cancelOrder()}
              className="btn-secondary"
            >
              {pending === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Cards in this order</h2>
        <div className="card flex flex-col divide-y divide-border overflow-hidden">
          {order.orderRecipients.map((line) => (
            <div key={line.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <div className="flex flex-col">
                <span>
                  {line.shippingAddressCity}, {line.shippingAddressPostcode}
                </span>
                <span className="text-xs text-muted">
                  {line.postageClass === "first_class" ? "First class" : "Second class"} ·{" "}
                  {formatGbp(line.priceMinor + line.postageMinor)}
                </span>
              </div>
              <span className="pill pill-muted">{ORDER_RECIPIENT_STATUS_LABELS[line.status]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
