import type { BatchOrderStatus, OrderRecipientStatus } from "@kudos/shared-types";

/** Customer-facing labels for a batch order's lifecycle. */
export const ORDER_STATUS_LABELS: Record<BatchOrderStatus, string> = {
  draft: "Not checked out",
  pending_payment: "Awaiting payment",
  paid: "Paid",
  fulfilling: "In production",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Tailwind classes (bg + text) for a small status pill, per order status.
 * Composed with the pill sizing utilities at the call site. */
export const ORDER_STATUS_CLASSES: Record<BatchOrderStatus, string> = {
  draft: "bg-foreground/[0.07] text-muted",
  pending_payment: "bg-amber-500/15 text-amber-700",
  paid: "bg-blue-500/10 text-blue-700",
  fulfilling: "bg-accent-soft text-accent",
  completed: "bg-success-soft text-success",
  cancelled: "bg-foreground/[0.07] text-muted",
};

export const ORDER_RECIPIENT_STATUS_LABELS: Record<OrderRecipientStatus, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  queued: "Queued for print",
  printed: "Printed",
  posted: "Posted",
  delivered: "Delivered",
  returned_to_sender: "Returned to sender",
  cancelled: "Cancelled",
};

/** A draft or awaiting-payment order can still be paid or cancelled. */
export function isPayable(status: BatchOrderStatus): boolean {
  return status === "draft" || status === "pending_payment";
}

/**
 * The header status to show for an order, refined by its cards' actual progress.
 *
 * A batch order stays `fulfilling` ("In production") until *every* card is
 * `delivered`, so an order whose cards are already `posted` still reads "In
 * production" while each card line says "Posted" — a confusing contradiction.
 * When every non-cancelled card has been posted (or delivered), surface the
 * order as "On its way" instead, so the header agrees with the per-card
 * statuses. Every other status maps straight through.
 */
export function orderHeaderStatus(
  status: BatchOrderStatus,
  lineStatuses: OrderRecipientStatus[],
): { label: string; className: string } {
  if (status === "fulfilling") {
    const active = lineStatuses.filter((s) => s !== "cancelled");
    if (active.length > 0 && active.every((s) => s === "posted" || s === "delivered")) {
      // Blue "in transit" tone (shared with `paid`) — clearly past production.
      return { label: "On its way", className: ORDER_STATUS_CLASSES.paid };
    }
  }
  return { label: ORDER_STATUS_LABELS[status], className: ORDER_STATUS_CLASSES[status] };
}

export function formatGbp(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  return `${sign}£${(Math.abs(minor) / 100).toFixed(2)}`;
}

export function formatOrderDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
