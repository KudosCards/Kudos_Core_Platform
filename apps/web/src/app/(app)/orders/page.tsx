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
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
        <p className="text-muted">
          Every batch sent to production, printed and posted by Kudos Cards, and any still awaiting
          payment.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">
          No orders yet — approve some occasions and head to{" "}
          <Link href="/batch-orders" className="text-accent hover:underline">
            Checkout
          </Link>
          .
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border px-5 py-3 sm:grid-cols-[1.5fr_1fr_0.6fr_0.9fr_0.7fr]">
            <span className="section-label">Order</span>
            <span className="section-label hidden sm:block">Date</span>
            <span className="section-label hidden text-right sm:block">Cards</span>
            <span className="section-label">Status</span>
            <span className="section-label text-right">Total</span>
          </div>
          <div className="divide-y divide-border">
            {items.map((order) => (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-foreground/[0.02] sm:grid-cols-[1.5fr_1fr_0.6fr_0.9fr_0.7fr]"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">
                    {order.orderRecipients.length} card
                    {order.orderRecipients.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-xs text-muted sm:hidden">
                    {formatOrderDate(order.createdAt)}
                  </span>
                </div>
                <span className="hidden text-sm text-muted sm:block">
                  {formatOrderDate(order.createdAt)}
                </span>
                <span className="hidden text-right text-sm text-muted sm:block">
                  {order.orderRecipients.length}
                </span>
                <span>
                  <span className={`pill ${ORDER_STATUS_CLASSES[order.status]}`}>
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                </span>
                <span className="text-right font-semibold">{formatGbp(order.totalMinor)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
