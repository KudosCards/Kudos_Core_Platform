import type { BatchOrderStatus, OrderCardStatusCounts } from "@kudos/shared-types";
import { orderHeaderStatus } from "@/lib/orders";

/**
 * The customer-facing status of one order, as a pill.
 *
 * One component rather than two call sites, because the two screens had already
 * drifted apart once: the orders list read `ORDER_STATUS_LABELS[order.status]`
 * raw while the order page ran the same order through `orderHeaderStatus`, so a
 * posted-but-not-delivered order read "In production" in the list and "On its
 * way" on its own page. Same order, same moment, two answers.
 *
 * Fixing both call sites would have left the next screen free to drift again.
 * Sharing the component means there is only one answer to keep right.
 *
 * Kudos HQ's own views deliberately do NOT use this. An operator wants the true
 * order status, and the ops status filter has to offer the real values — you
 * cannot query for a label that only exists in the UI.
 */
export function OrderStatusPill({
  status,
  cardStatusCounts,
}: {
  status: BatchOrderStatus;
  cardStatusCounts: OrderCardStatusCounts;
}) {
  const { label, className } = orderHeaderStatus(status, cardStatusCounts);
  return <span className={`pill ${className}`}>{label}</span>;
}
