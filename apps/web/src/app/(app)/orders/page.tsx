import Link from "next/link";
import type { BatchOrder } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import {
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  formatGbp,
  formatOrderDate,
} from "@/lib/orders";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function OrdersPage() {
  const orders = await serverApiFetch<Paginated<BatchOrder>>("/batch-orders?perPage=50");
  const items = orders?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-foreground/60">Every batch you&apos;ve sent to production, and any still awaiting payment.</p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-foreground/60">
          No orders yet — approve some occasions and head to{" "}
          <Link href="/batch-orders" className="underline">
            Checkout
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
          {items.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">
                  {order.orderRecipients.length} card{order.orderRecipients.length === 1 ? "" : "s"} ·{" "}
                  {formatGbp(order.totalMinor)}
                </span>
                <span className="text-xs text-foreground/50">{formatOrderDate(order.createdAt)}</span>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${ORDER_STATUS_CLASSES[order.status]}`}
              >
                {ORDER_STATUS_LABELS[order.status]}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
