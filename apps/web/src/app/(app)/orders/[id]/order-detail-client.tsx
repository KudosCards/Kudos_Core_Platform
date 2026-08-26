"use client";

import { Calendar } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { BatchOrderDetail } from "@kudos/shared-types";
import {
  computePricingBreakdown,
  deliverByWindow,
  describeSendSchedule,
  isoDay,
  royalMailTrackingUrl,
  startOfUtcDay,
  summariseSendSchedule,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { PricingBreakdownCard } from "@/components/pricing-breakdown";
import { downloadOrderProofSheet } from "@/app/(app)/send/contact-sheet";
import {
  ORDER_RECIPIENT_STATUS_LABELS,
  formatGbp,
  formatOrderDate,
  isPayable,
  orderHeaderStatus,
} from "@/lib/orders";

/** Mirrors summariseSendSchedule's idea of "already left us" — a posted card
 * has no upcoming post date to show, only a tracking link. */
const DEPARTED_LINE_STATUSES = new Set(["posted", "delivered", "returned_to_sender", "cancelled"]);

export function OrderDetailClient({
  order,
  walletBalanceMinor,
}: {
  order: BatchOrderDetail;
  walletBalanceMinor: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const payable = isPayable(order.status);
  const canWalletPay = order.status === "draft" && walletBalanceMinor >= order.totalMinor;

  // Scheduled-send management (ADR 0130). A paid order still holding cards can
  // be moved to a new date, as long as none has moved past `pending`.
  //
  // Summarised across every card rather than read off the first one. An
  // occasion-timed order (ADR 0160) posts each card ahead of its own recipient's
  // date, so "the order's post date" is usually several dates — and once the
  // earliest card had gone, keying off it made the whole banner disappear while
  // the rest were still waiting.
  const schedule = summariseSendSchedule(order.orderRecipients);
  // The wording lives in shared-types, pure and unit-tested — the exact
  // sentences are what this change is for, so they are asserted rather than
  // eyeballed. See describeSendSchedule.
  const scheduleCopy = describeSendSchedule(schedule, formatOrderDate);
  const today = startOfUtcDay(new Date());
  // Today counts as scheduled: a card going out this morning is still news, and
  // having the banner vanish on the day is exactly the disappearing act above.
  const isScheduled =
    (order.status === "paid" || order.status === "fulfilling") &&
    schedule.toCome > 0 &&
    schedule.earliest !== null &&
    startOfUtcDay(schedule.earliest).getTime() >= today.getTime();
  const anyStarted = order.orderRecipients.some((l) => l.jobStatus && l.jobStatus !== "pending");
  const canReschedule = isScheduled && !anyStarted;
  const rescheduleWindow = deliverByWindow(
    order.orderRecipients[0]?.postageClass ?? "second_class",
  );

  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDeliverBy, setNewDeliverBy] = useState(isoDay(rescheduleWindow.earliest));

  async function submitReschedule() {
    setError(null);
    setPending("reschedule");
    try {
      await clientApiFetch(`/batch-orders/${order.id}/schedule`, {
        method: "PATCH",
        body: JSON.stringify({ deliverBy: newDeliverBy }),
      });
      setRescheduleOpen(false);
      router.refresh();
    } catch (rescheduleError) {
      setError(
        rescheduleError instanceof ApiError ? rescheduleError.message : "Could not reschedule",
      );
      setPending(null);
    }
  }

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

  const [confirmRefund, setConfirmRefund] = useState(false);

  async function cancelAndRefund() {
    setError(null);
    setPending("refund");
    try {
      await clientApiFetch(`/batch-orders/${order.id}/cancel-refund`, { method: "POST" });
      setConfirmRefund(false);
      router.refresh();
    } catch (refundError) {
      setError(
        refundError instanceof ApiError ? refundError.message : "Could not cancel and refund",
      );
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
          {(() => {
            const header = orderHeaderStatus(
              order.status,
              order.orderRecipients.map((l) => l.status),
            );
            return <span className={`pill ${header.className}`}>{header.label}</span>;
          })()}
        </div>
        <p className="text-sm text-muted">Ordered {formatOrderDate(order.createdAt)}</p>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

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
            {/* A split order records `card` as its payment method — the wallet
                is always spent first (ADR 0169) — so the two-value method alone
                would hide the wallet half entirely. Read the split from the
                amount, not the method. */}
            <span className="text-right">
              {order.paymentMethod === "wallet" ? (
                "Wallet"
              ) : order.walletAppliedMinor > 0 ? (
                <>
                  {formatGbp(order.walletAppliedMinor)} from wallet
                  <br />
                  {formatGbp(order.totalMinor - order.walletAppliedMinor)} on card
                </>
              ) : (
                "Card"
              )}
            </span>
          </div>
        )}
        {(order.receiptPdfUrl || order.receiptUrl) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-muted">
              VAT receipt
              {order.walletAppliedMinor > 0 && (
                // Otherwise the receipt total silently disagrees with the order
                // total, and the customer has no way to know why.
                <span className="block text-xs">
                  Covers the {formatGbp(order.totalMinor - order.walletAppliedMinor)} charged to
                  your card
                </span>
              )}
            </span>
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

      {isScheduled && scheduleCopy && (
        <div className="banner banner-info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="banner-lead text-sm">
              <Calendar className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden /> Scheduled —{" "}
              {scheduleCopy.lead}
            </p>
            {canReschedule && !rescheduleOpen && (
              <button
                type="button"
                onClick={() => setRescheduleOpen(true)}
                className="btn-secondary text-sm"
              >
                Reschedule
              </button>
            )}
          </div>
          {/* Why the dates are what they are. A customer who chose "time each
              card to its own occasion" at checkout was told their cards would
              spread across a range; being handed a single date afterwards made
              them doubt the scheduling had worked at all. Say the same thing on
              both screens. */}
          {scheduleCopy.detail && <p className="text-xs text-muted">{scheduleCopy.detail}</p>}
          {canReschedule && rescheduleOpen && (
            <div className="flex flex-col gap-2 border-t border-current/15 pt-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">
                  New arrive-by date{schedule.isSpread ? " for every card" : ""}
                </span>
                <input
                  type="date"
                  value={newDeliverBy}
                  min={isoDay(rescheduleWindow.earliest)}
                  max={isoDay(rescheduleWindow.latest)}
                  onChange={(e) => setNewDeliverBy(e.target.value)}
                  className="w-fit rounded-md border border-black/15 px-2 py-1 dark:border-white/15"
                />
              </label>
              {/* Rescheduling writes ONE arrive-by date to every card in the
                  order (batch-orders.service.ts reschedule). On an order whose
                  cards are timed to their own occasions that quietly throws the
                  timing away — seven birthdays collapsed onto one day — and it
                  cannot be undone from here. Say so before they click, and put
                  the consequence in the button's own label rather than relying
                  on them having read the paragraph above it. */}
              {schedule.isSpread && (
                <p className="notice notice-warning">
                  These {schedule.toCome} cards are timed to {schedule.dates.length} different
                  occasions. Rescheduling moves all of them to the one date above and discards that
                  timing — we can&apos;t put it back for you.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void submitReschedule()}
                  className="btn-accent text-sm"
                >
                  {pending === "reschedule"
                    ? "Saving…"
                    : schedule.isSpread
                      ? `Move all ${schedule.toCome} cards to one date`
                      : "Save new date"}
                </button>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => setRescheduleOpen(false)}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {canReschedule ? (
            <div className="flex flex-col gap-2 border-t border-current/15 pt-3">
              {!confirmRefund ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    Changed your mind? You can cancel and get a full refund while it&apos;s still
                    held.
                  </p>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => setConfirmRefund(true)}
                    className="btn-secondary text-sm"
                  >
                    Cancel &amp; refund
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-foreground">
                    Cancel {order.orderRecipients.length === 1 ? "this card" : "these cards"} and
                    refund {formatGbp(order.totalMinor)} to your{" "}
                    {order.paymentMethod === "wallet" ? "wallet" : "original card"}?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void cancelAndRefund()}
                      className="btn-accent text-sm"
                    >
                      {pending === "refund" ? "Refunding…" : "Yes, cancel & refund"}
                    </button>
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => setConfirmRefund(false)}
                      className="btn-secondary text-sm"
                    >
                      Keep my order
                    </button>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted">
                Need to change the contacts instead?{" "}
                <Link href="/support" className="text-accent hover:underline">
                  Contact support
                </Link>
                .
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted">
              Paid and held until then. Need to change the contacts or cancel it?{" "}
              <Link href="/support" className="text-accent hover:underline">
                Contact support
              </Link>{" "}
              and we&apos;ll sort it before it posts.
            </p>
          )}
        </div>
      )}

      {payable && (
        <div className="banner banner-warning">
          <p className="banner-lead text-sm">
            This order hasn&apos;t been paid yet. Pay to send it to production, or cancel to release
            its cards back to Approvals.
          </p>
          {/* The wallet is spent first, automatically (ADR 0169). Say so before
              they click: being charged less than the total is a pleasant
              surprise, but a surprise on a payment screen is still bad. */}
          {order.status === "draft" && walletBalanceMinor > 0 && (
            <p className="text-sm">
              {canWalletPay ? (
                <>
                  Your wallet balance of <strong>{formatGbp(walletBalanceMinor)}</strong> covers this
                  order in full — paying takes it from your balance, and your card won&apos;t be
                  charged.
                </>
              ) : (
                <>
                  Your wallet balance of <strong>{formatGbp(walletBalanceMinor)}</strong> is used
                  first, so your card will be charged{" "}
                  <strong>{formatGbp(order.totalMinor - walletBalanceMinor)}</strong>.
                </>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void payByCard()}
              className="btn-accent"
            >
              {pending === "card" ? "Redirecting…" : "Pay by card"}
            </button>
            {/* Kept for an order whose balance covers it outright, where it is
                the more honest label — "Pay by card" now spends the wallet first
                either way, so this is a shortcut, not a separate route. */}
            {order.status === "draft" && canWalletPay && (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void payWithWallet()}
                className="btn-secondary"
              >
                {pending === "wallet" ? "Paying…" : "Pay from wallet"}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Cards in this order</h2>
          <button
            type="button"
            onClick={() => downloadOrderProofSheet(order)}
            className="text-xs text-muted underline hover:text-foreground"
            title="Download a printable record of every card, address and status"
          >
            ⬇ Download proof sheet
          </button>
        </div>
        <div className="card flex flex-col divide-y divide-border overflow-hidden">
          {order.orderRecipients.map((line) => (
            <div
              key={line.id}
              className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col">
                <span className="font-medium">
                  {line.recipientFirstName} {line.recipientLastName}
                </span>
                <span className="text-xs text-muted">
                  {[
                    line.shippingAddressLine1,
                    line.shippingAddressCity,
                    line.shippingAddressPostcode,
                  ]
                    .filter(Boolean)
                    .join(", ")}{" "}
                  · {line.postageClass === "first_class" ? "First class" : "Second class"} ·{" "}
                  {formatGbp(line.priceMinor + line.postageMinor)}
                </span>
                {/* Each card's own post date. Without this the banner above was
                    the only date anywhere in the customer's view of the order,
                    so there was nothing to check it against — and on an
                    occasion-timed send the single date it named was wrong for
                    most of the cards. */}
                {line.dispatchDate && !DEPARTED_LINE_STATUSES.has(line.status) && (
                  <span className="text-xs text-muted">
                    Posts {formatOrderDate(line.dispatchDate)}
                  </span>
                )}
                {(line.trackingReference || line.messagePageSlug) && (
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    {line.trackingReference && (
                      <a
                        href={royalMailTrackingUrl(line.trackingReference)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-accent hover:underline"
                      >
                        Track delivery →
                      </a>
                    )}
                    {line.messagePageSlug && (
                      <a
                        href={`/r/${line.messagePageSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted hover:text-foreground hover:underline"
                      >
                        View digital message
                      </a>
                    )}
                  </span>
                )}
              </div>
              <span className="pill pill-muted shrink-0 self-start sm:self-auto">
                {ORDER_RECIPIENT_STATUS_LABELS[line.status]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
