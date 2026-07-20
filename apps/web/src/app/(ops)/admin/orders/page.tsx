import Link from "next/link";
import type { BatchOrderStatus } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ORDER_STATUS_CLASSES, ORDER_STATUS_LABELS, formatGbp, formatOrderDate } from "@/lib/orders";

interface AdminOrderRow {
  id: string;
  accountId: string;
  accountName: string;
  status: BatchOrderStatus;
  totalMinor: number;
  currency: string;
  cardCount: number;
  paymentMethod: string | null;
  createdAt: string;
}

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

/** Status filters offered in the UI (draft carts are hidden by default). */
const FILTERS: { value: BatchOrderStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "fulfilling", label: "In production" },
  { value: "completed", label: "Completed" },
  { value: "pending_payment", label: "Awaiting payment" },
  { value: "cancelled", label: "Cancelled" },
];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = FILTERS.find((f) => f.value === status)?.value ?? "all";
  const query = active === "all" ? "perPage=100" : `status=${active}&perPage=100`;
  const result = await serverApiFetch<Paginated<AdminOrderRow>>(`/admin/orders?${query}`);
  const orders = result?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Orders</h1>
        <p className="text-sm text-foreground/60">
          Every order across all accounts{result ? ` · ${result.total.toLocaleString("en-GB")} total` : ""}.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value === "all" ? "/admin/orders" : `/admin/orders?status=${filter.value}`}
            className={`rounded-full px-3 py-1.5 text-sm ${
              active === filter.value
                ? "bg-foreground text-background"
                : "text-foreground/60 hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
        {orders.length === 0 ? (
          <p className="p-6 text-sm text-foreground/60">No orders to show.</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs tracking-wide text-foreground/50 uppercase dark:border-white/10">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Cards</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
                <th className="px-5 py-3 font-medium">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="px-5 py-3 whitespace-nowrap text-foreground/70">
                    {formatOrderDate(order.createdAt)}
                  </td>
                  <td className="px-5 py-3 font-medium">{order.accountName}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_CLASSES[order.status]}`}
                    >
                      {ORDER_STATUS_LABELS[order.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-foreground/70">
                    {order.cardCount}
                  </td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">
                    {formatGbp(order.totalMinor)}
                  </td>
                  <td className="px-5 py-3 text-foreground/60 capitalize">
                    {order.paymentMethod ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
