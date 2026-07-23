"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { OCCASION_TYPE_LABELS, formatOccasionDate } from "@/lib/occasions";
import type { OccasionWithRecipient } from "../approvals/approvals-client";

interface LineDraft {
  shippingAddressLine1: string;
  shippingAddressLine2: string;
  shippingAddressCity: string;
  shippingAddressPostcode: string;
  dispatchOption: "asap" | "auto_send";
  postageClass: "first_class" | "second_class";
}

const EMPTY_LINE: LineDraft = {
  shippingAddressLine1: "",
  shippingAddressLine2: "",
  shippingAddressCity: "",
  shippingAddressPostcode: "",
  dispatchOption: "asap",
  postageClass: "first_class",
};

const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

export interface UnfinishedBatchOrder {
  id: string;
  status: "draft" | "pending_payment";
  totalMinor: number;
  orderRecipients: unknown[];
}

function formatGbp(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}

export function BatchOrdersClient({
  initialOccasions,
  initialUnfinishedOrders,
  walletBalanceMinor,
}: {
  initialOccasions: OccasionWithRecipient[];
  initialUnfinishedOrders: UnfinishedBatchOrder[];
  walletBalanceMinor: number;
}) {
  const [lines, setLines] = useState<Record<string, LineDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [walletSubmitting, setWalletSubmitting] = useState(false);
  const [unfinishedOrders, setUnfinishedOrders] = useState(initialUnfinishedOrders);
  const [orderActionPending, setOrderActionPending] = useState<string | null>(null);

  const selectedIds = Object.keys(lines);

  function toggle(occasionId: string) {
    setLines((current) => {
      if (occasionId in current) {
        const next = { ...current };
        delete next[occasionId];
        return next;
      }
      return { ...current, [occasionId]: { ...EMPTY_LINE } };
    });
  }

  function updateLine(occasionId: string, patch: Partial<LineDraft>) {
    setLines((current) => ({ ...current, [occasionId]: { ...current[occasionId]!, ...patch } }));
  }

  /** Validates the current selection, returning an error message or null. */
  function validateSelection(): string | null {
    if (selectedIds.length === 0) {
      return "Select at least one occasion to include";
    }
    for (const occasionId of selectedIds) {
      const line = lines[occasionId]!;
      if (
        !line.shippingAddressLine1 ||
        !line.shippingAddressCity ||
        !line.shippingAddressPostcode
      ) {
        return "Fill in the shipping address for every selected card";
      }
    }
    return null;
  }

  function createDraftFromSelection(): Promise<UnfinishedBatchOrder> {
    return clientApiFetch<UnfinishedBatchOrder>("/batch-orders", {
      method: "POST",
      body: JSON.stringify({
        lines: selectedIds.map((occasionId) => ({ occasionId, ...lines[occasionId]! })),
      }),
    });
  }

  /** A created draft whose payment step failed must not vanish — its occasions
   * are already consumed, so surface it in the unfinished list to retry/cancel. */
  function keepDraftVisible(order: UnfinishedBatchOrder) {
    setUnfinishedOrders((current) =>
      current.some((o) => o.id === order.id) ? current : [...current, order],
    );
  }

  async function handleCheckout() {
    setError(null);
    setNotice(null);
    const validationError = validateSelection();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    let order: UnfinishedBatchOrder | undefined;
    try {
      order = await createDraftFromSelection();
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>(
        `/batch-orders/${order.id}/checkout`,
        { method: "POST" },
      );
      window.location.assign(checkoutUrl);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof ApiError ? checkoutError.message : "Could not start checkout",
      );
      setSubmitting(false);
      if (order) {
        keepDraftVisible(order);
      }
    }
  }

  async function handleWalletCheckout() {
    setError(null);
    setNotice(null);
    const validationError = validateSelection();
    if (validationError) {
      setError(validationError);
      return;
    }

    setWalletSubmitting(true);
    let order: UnfinishedBatchOrder | undefined;
    try {
      order = await createDraftFromSelection();
      await payWithWallet(order.id);
      // Occasions are now paid & queued — drop them from the selection so the
      // page reflects it without a full reload.
      setLines({});
      setNotice(`Paid ${selectedIds.length} card(s) from your wallet — off to production.`);
    } catch (walletError) {
      setError(walletError instanceof ApiError ? walletError.message : "Could not pay from wallet");
      if (order) {
        keepDraftVisible(order);
      }
    } finally {
      setWalletSubmitting(false);
    }
  }

  /** Shared by the main flow and the unfinished-orders list. Throws on failure
   * so callers can decide how to surface it. */
  async function payWithWallet(orderId: string): Promise<void> {
    await clientApiFetch(`/wallet/pay/${orderId}`, { method: "POST" });
    setUnfinishedOrders((current) => current.filter((o) => o.id !== orderId));
  }

  async function payOrderWithWallet(orderId: string) {
    setError(null);
    setNotice(null);
    setOrderActionPending(orderId);
    try {
      await payWithWallet(orderId);
      setNotice("Order paid from your wallet — off to production.");
    } catch (payError) {
      setError(payError instanceof ApiError ? payError.message : "Could not pay from wallet");
    } finally {
      setOrderActionPending(null);
    }
  }

  async function resumeCheckout(orderId: string) {
    setError(null);
    setOrderActionPending(orderId);
    try {
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>(
        `/batch-orders/${orderId}/checkout`,
        { method: "POST" },
      );
      window.location.assign(checkoutUrl);
    } catch (resumeError) {
      setError(resumeError instanceof ApiError ? resumeError.message : "Could not resume checkout");
      setOrderActionPending(null);
    }
  }

  async function cancelOrder(orderId: string) {
    setError(null);
    setOrderActionPending(orderId);
    try {
      await clientApiFetch(`/batch-orders/${orderId}/cancel`, { method: "POST" });
      setUnfinishedOrders((current) => current.filter((o) => o.id !== orderId));
    } catch (cancelError) {
      setError(cancelError instanceof ApiError ? cancelError.message : "Could not cancel order");
    } finally {
      setOrderActionPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
        <p className="text-muted">
          Choose which approved occasions to send to print. Kudos Cards prints, packs and posts every
          card straight to your recipient — no shipping admin on your end.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}
      {notice && (
        <p className="rounded-lg bg-[#e8f1ea] px-4 py-3 text-sm font-medium text-[#2f7d54]">
          {notice}
        </p>
      )}

      <p className="text-sm text-muted">
        Wallet balance:{" "}
        <span className="font-semibold text-foreground">{formatGbp(walletBalanceMinor)}</span> ·{" "}
        <Link href="/wallet" className="text-accent hover:underline">
          Top up
        </Link>
      </p>

      {unfinishedOrders.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="font-semibold">Unfinished orders</h2>
          <p className="text-sm text-foreground/60">
            These orders haven&apos;t been paid for yet — resume checkout or cancel to release their
            cards back to Approvals.
          </p>
          <div className="flex flex-col gap-2">
            {unfinishedOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
              >
                <span>
                  {order.orderRecipients.length} card(s) · {formatGbp(order.totalMinor)} ·{" "}
                  {order.status === "draft" ? "not checked out" : "payment pending"}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={orderActionPending === order.id}
                    onClick={() => void resumeCheckout(order.id)}
                    className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {order.status === "draft" ? "Pay by card" : "Resume checkout"}
                  </button>
                  {order.status === "draft" && (
                    <button
                      type="button"
                      disabled={
                        orderActionPending === order.id || walletBalanceMinor < order.totalMinor
                      }
                      onClick={() => void payOrderWithWallet(order.id)}
                      title={
                        walletBalanceMinor < order.totalMinor
                          ? "Not enough wallet balance — top up first"
                          : undefined
                      }
                      className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Pay with wallet
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={orderActionPending === order.id}
                    onClick={() => void cancelOrder(order.id)}
                    className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {initialOccasions.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">
          Nothing is approved and ready yet — visit{" "}
          <Link href="/approvals" className="text-accent hover:underline">
            Approvals
          </Link>{" "}
          to approve some occasions first.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {initialOccasions.map((occasion) => {
            const selected = lines[occasion.id];
            return (
              <div key={occasion.id} className="card flex flex-col gap-3 p-4">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected !== undefined}
                    onChange={() => toggle(occasion.id)}
                    className="accent-accent"
                  />
                  <span className="font-semibold">
                    {OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type}
                    {occasion.recipient && (
                      <>
                        {" for "}
                        {occasion.recipient.firstName} {occasion.recipient.lastName}
                      </>
                    )}
                  </span>
                  <span className="text-sm text-muted">
                    {formatOccasionDate(occasion.occasionDate)}
                  </span>
                </label>

                {selected && (
                  <div className="grid gap-2 pl-7 sm:grid-cols-2">
                    <input
                      placeholder="Address line 1"
                      value={selected.shippingAddressLine1}
                      onChange={(e) =>
                        updateLine(occasion.id, { shippingAddressLine1: e.target.value })
                      }
                      className={inputClass}
                    />
                    <input
                      placeholder="Address line 2 (optional)"
                      value={selected.shippingAddressLine2}
                      onChange={(e) =>
                        updateLine(occasion.id, { shippingAddressLine2: e.target.value })
                      }
                      className={inputClass}
                    />
                    <input
                      placeholder="City"
                      value={selected.shippingAddressCity}
                      onChange={(e) =>
                        updateLine(occasion.id, { shippingAddressCity: e.target.value })
                      }
                      className={inputClass}
                    />
                    <input
                      placeholder="Postcode"
                      value={selected.shippingAddressPostcode}
                      onChange={(e) =>
                        updateLine(occasion.id, { shippingAddressPostcode: e.target.value })
                      }
                      className={inputClass}
                    />
                    <select
                      value={selected.dispatchOption}
                      onChange={(e) =>
                        updateLine(occasion.id, {
                          dispatchOption: e.target.value as LineDraft["dispatchOption"],
                        })
                      }
                      className={inputClass}
                    >
                      <option value="asap">Dispatch as soon as possible</option>
                      <option value="auto_send">Auto-send ahead of the occasion date</option>
                    </select>
                    <select
                      value={selected.postageClass}
                      onChange={(e) =>
                        updateLine(occasion.id, {
                          postageClass: e.target.value as LineDraft["postageClass"],
                        })
                      }
                      className={inputClass}
                    >
                      <option value="first_class">First class post (+£1.80/card)</option>
                      <option value="second_class">Second class post (+£0.91/card)</option>
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {initialOccasions.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={submitting || walletSubmitting || selectedIds.length === 0}
            onClick={() => void handleCheckout()}
            className="btn-accent"
          >
            {submitting ? "Starting checkout…" : `Pay by card for ${selectedIds.length} card(s)`}
          </button>
          <button
            type="button"
            disabled={submitting || walletSubmitting || selectedIds.length === 0}
            onClick={() => void handleWalletCheckout()}
            className="btn-secondary"
          >
            {walletSubmitting ? "Paying…" : "Pay with wallet"}
          </button>
        </div>
      )}
    </div>
  );
}
