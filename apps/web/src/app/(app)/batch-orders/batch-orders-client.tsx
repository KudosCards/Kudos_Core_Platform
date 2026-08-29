"use client";

import { Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AccountPricing, BatchOrderListRow } from "@kudos/shared-types";
import { computePricingBreakdown, suggestFirstClass } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { TruncationNotice } from "@/components/truncation-notice";
import { clientApiFetch } from "@/lib/api.client";
import { PricingBreakdownCard } from "@/components/pricing-breakdown";
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

/** A checkout line pre-filled from the contact's stored address — so an address
 * already on the record isn't re-keyed at checkout. Falls back to blank fields
 * when the contact has no address yet. See ADR 0119. */
function lineFromOccasion(occasion: OccasionWithRecipient | undefined): LineDraft {
  const r = occasion?.recipient;
  return {
    ...EMPTY_LINE,
    shippingAddressLine1: r?.addressLine1 ?? "",
    shippingAddressLine2: r?.addressLine2 ?? "",
    shippingAddressCity: r?.addressCity ?? "",
    shippingAddressPostcode: r?.addressPostcode ?? "",
  };
}

const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

/**
 * A draft or awaiting-payment order, as the orders *list* returns it.
 *
 * Derived from BatchOrderListRow rather than hand-written, because a
 * hand-written copy is what broke here: this declared `orderRecipients` and the
 * list stopped sending them (ADR 0170), so `.length` read `undefined` at
 * runtime. `serverApiFetch<T>` is an unchecked cast, so nothing caught it.
 * Deriving means the next payload change fails typecheck instead.
 */
export type UnfinishedBatchOrder = Pick<BatchOrderListRow, "id" | "totalMinor" | "cardCount"> & {
  status: "draft" | "pending_payment";
};

/** What POST /batch-orders returns: the created order *with* its lines, which is
 * a different shape from the list row above. Normalised on the way in so both
 * sources render through one path. */
interface CreatedDraftResponse {
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
  totalApproved,
  initialUnfinishedOrders,
  walletBalanceMinor,
  initialSelectedIds = [],
  pricing,
  maxPerOrder,
}: {
  initialOccasions: OccasionWithRecipient[];
  /** How many are approved and waiting in total, which can exceed one read. */
  totalApproved: number;
  initialUnfinishedOrders: UnfinishedBatchOrder[];
  walletBalanceMinor: number;
  /** Occasion ids pre-ticked from the calendar list-view bulk action. */
  initialSelectedIds?: string[];
  /** The account's live per-card pricing, for the checkout estimate. */
  pricing: AccountPricing;
  /** Plan's `batchOrderMaxSize` — the most cards allowed in a single order. */
  maxPerOrder: number;
}) {
  const router = useRouter();
  const occasionById = useMemo(
    () => new Map(initialOccasions.map((o) => [o.id, o])),
    [initialOccasions],
  );
  const [lines, setLines] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(
      initialSelectedIds.map((id) => [id, lineFromOccasion(occasionById.get(id))]),
    ),
  );
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
      return { ...current, [occasionId]: lineFromOccasion(occasionById.get(occasionId)) };
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
    if (selectedIds.length > maxPerOrder) {
      return `You can send up to ${maxPerOrder} cards per order — deselect ${
        selectedIds.length - maxPerOrder
      } to continue, then start another order for the rest.`;
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

  async function createDraftFromSelection(): Promise<UnfinishedBatchOrder> {
    const created = await clientApiFetch<CreatedDraftResponse>("/batch-orders", {
      method: "POST",
      body: JSON.stringify({
        lines: selectedIds.map((occasionId) => ({ occasionId, ...lines[occasionId]! })),
      }),
    });
    return {
      id: created.id,
      status: created.status,
      totalMinor: created.totalMinor,
      cardCount: created.orderRecipients.length,
    };
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
    // Paid occasions are now queued (no longer "approved"), so re-fetch to drop
    // them from the list rather than leave a stale, still-selectable row.
    router.refresh();
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
        // Explicit resume intent: mint a fresh Stripe session for this
        // already-pending_payment order. A first checkout omits this so
        // concurrent double-submits can't each reach Stripe. See ADR 0125.
        { method: "POST", body: JSON.stringify({ resume: true }) },
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
      // Cancelling releases the order's occasions back to "approved" — re-fetch so
      // they reappear in the list below without a manual page reload.
      router.refresh();
    } catch (cancelError) {
      setError(cancelError instanceof ApiError ? cancelError.message : "Could not cancel order");
    } finally {
      setOrderActionPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* A checkout list that ends without saying so hides cards the customer
          has already approved and is waiting to send. */}
      <TruncationNotice
        shown={initialOccasions.length}
        total={totalApproved}
        unit="approved and ready to send"
        hint="Order some of these to see the rest."
      />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
        <p className="text-muted">
          This is where occasions you’ve already approved on the{" "}
          <Link href="/calendar" className="text-accent hover:underline">
            calendar
          </Link>{" "}
          get paid for and sent to print. Just want to post a card now?{" "}
          <Link href="/send" className="text-accent hover:underline">
            Send a card
          </Link>{" "}
          is the quicker route. You can send up to {maxPerOrder} cards per order; Kudos Cards
          prints, packs and posts each one straight to your contact — no shipping admin on your end.
        </p>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}
      {notice && (
        <p className="rounded-lg bg-success-soft px-4 py-3 text-sm font-medium text-success">
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
        <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-soft p-4">
          <h2 className="font-semibold">Unfinished orders</h2>
          <p className="text-sm text-foreground/60">
            These orders haven’t been paid for yet — resume checkout or cancel to release their
            cards back to Approvals.
          </p>
          <div className="flex flex-col gap-2">
            {unfinishedOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
              >
                <span>
                  {order.cardCount} card(s) · {formatGbp(order.totalMinor)} ·{" "}
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
          {(() => {
            // Warn (don't block) when a selected contact had a card returned and
            // the address isn't re-verified — checkout is where the spend happens.
            const flagged = initialOccasions.filter(
              (o) => lines[o.id] && o.recipient?.addressVerificationRequired,
            );
            if (flagged.length === 0) return null;
            const names = flagged
              .map((o) =>
                o.recipient ? `${o.recipient.firstName} ${o.recipient.lastName}` : "A contact",
              )
              .join(", ");
            return (
              <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-foreground">
                <p className="font-semibold">⚠️ Check the address before sending</p>
                <p className="mt-1">
                  A card to {names} was recently returned. Update the address on the contact record
                  if it’s changed — otherwise it may come back again. You can still send now.
                </p>
              </div>
            );
          })()}
          {(() => {
            // Cards greet the recipient by first name ({firstName}); a selected
            // contact without one would print an awkward blank. Warn before they
            // pay — don't block, since some may be intentional.
            const missingName = initialOccasions.filter(
              (o) => lines[o.id] && !o.recipient?.firstName?.trim(),
            );
            if (missingName.length === 0) return null;
            return (
              <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-foreground">
                <p className="font-semibold">
                  ⚠️ {missingName.length} contact{missingName.length === 1 ? " is" : "s are"}{" "}
                  missing a first name
                </p>
                <p className="mt-1">
                  Cards use the first name in the greeting, so these may read oddly. Add a first
                  name on the contact record before sending, or continue if that’s intended.
                </p>
              </div>
            );
          })()}
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
                  {occasion.recipient?.addressVerificationRequired && (
                    <Link
                      href={`/recipients/${occasion.recipientId}`}
                      title="A card to this contact was returned — check the address before sending"
                      className="ml-auto inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning hover:bg-warning/15"
                    >
                      ⚠️ Address returned
                    </Link>
                  )}
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
                    {(() => {
                      const nudge = suggestFirstClass(new Date(occasion.occasionDate));
                      if (!nudge.suggested || selected.postageClass === "first_class") return null;
                      return (
                        <button
                          type="button"
                          onClick={() => updateLine(occasion.id, { postageClass: "first_class" })}
                          title={nudge.reason}
                          className="inline-flex items-center gap-1 self-start rounded-full bg-warning-soft px-2 py-1 text-xs font-medium text-warning hover:bg-warning/15 sm:col-span-2"
                        >
                          <Zap className="h-3.5 w-3.5" aria-hidden /> {nudge.reason} Use First Class
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => toggle(occasion.id)}
                      className="self-start text-xs font-medium text-muted underline-offset-2 hover:text-accent hover:underline sm:col-span-2"
                    >
                      Remove from order
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedIds.length > 0 &&
        (() => {
          const postageMinor = selectedIds.reduce(
            (sum, id) => sum + pricing.postageMinor[lines[id]!.postageClass],
            0,
          );
          const breakdown = computePricingBreakdown({
            cardCount: selectedIds.length,
            cardSubtotalInclVatMinor: selectedIds.length * pricing.cardPriceMinor,
            postageMinor,
            fullCardPriceMinor: pricing.fullCardPriceMinor,
          });
          return (
            <div className="card max-w-sm p-5">
              <PricingBreakdownCard breakdown={breakdown} estimate />
            </div>
          );
        })()}

      {initialOccasions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            {selectedIds.length} of {maxPerOrder} selected
            {selectedIds.length > maxPerOrder && (
              <span className="ml-2 font-medium text-warning">
                — that’s over the {maxPerOrder}-card limit for this order. Deselect{" "}
                {selectedIds.length - maxPerOrder} to continue.
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={
                submitting ||
                walletSubmitting ||
                selectedIds.length === 0 ||
                selectedIds.length > maxPerOrder
              }
              onClick={() => void handleCheckout()}
              className="btn-accent"
            >
              {submitting ? "Starting checkout…" : `Pay by card for ${selectedIds.length} card(s)`}
            </button>
            <button
              type="button"
              disabled={
                submitting ||
                walletSubmitting ||
                selectedIds.length === 0 ||
                selectedIds.length > maxPerOrder
              }
              onClick={() => void handleWalletCheckout()}
              className="btn-secondary"
            >
              {walletSubmitting ? "Paying…" : "Pay with wallet"}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        By paying you agree to our{" "}
        <Link href="/terms" className="hover:underline">
          Terms & Conditions
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
