"use client";

import { useMemo, useState } from "react";
import type { BatchOrderStatus } from "@kudos/shared-types";
import { ORDER_STATUS_CLASSES, ORDER_STATUS_LABELS, formatGbp, formatOrderDate } from "@/lib/orders";
import { fulfillmentLabel, formatOrderNumber } from "@/lib/admin";

export interface AdminOrderRow {
  id: string;
  orderNumber: number;
  accountId: string;
  accountName: string;
  status: BatchOrderStatus;
  totalMinor: number;
  currency: string;
  cardCount: number;
  paymentMethod: string | null;
  createdAt: string;
}

const STATUS_OPTIONS: (BatchOrderStatus | "all")[] = [
  "all",
  "paid",
  "fulfilling",
  "completed",
  "pending_payment",
  "cancelled",
  "draft",
];

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

export function AdminOrdersClient({
  initialOrders,
  total,
}: {
  initialOrders: AdminOrderRow[];
  total: number;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<BatchOrderStatus | "all">("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialOrders.filter((order) => {
      if (status !== "all" && order.status !== status) return false;
      if (!q) return true;
      return (
        order.accountName.toLowerCase().includes(q) ||
        formatOrderNumber(order.orderNumber).toLowerCase().includes(q) ||
        String(order.orderNumber).includes(q)
      );
    });
  }, [initialOrders, search, status]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Orders</h1>
        <p className="text-sm text-muted">
          Every order across all accounts · {total.toLocaleString("en-GB")} total,{" "}
          {filtered.length.toLocaleString("en-GB")} shown.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by account or order id"
          className={`${inputClass} sm:max-w-xs`}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as BatchOrderStatus | "all")}
          className={`${inputClass} sm:max-w-xs`}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All statuses" : ORDER_STATUS_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted">No orders match your filters.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                <th className="px-5 py-3 font-medium">Order</th>
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Fulfillment</th>
                <th className="px-5 py-3 font-medium">Placed</th>
                <th className="px-5 py-3 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((order) => (
                <tr key={order.id} className="hover:bg-foreground/[0.02]">
                  <td className="px-5 py-3.5 font-semibold whitespace-nowrap tabular-nums">
                    {formatOrderNumber(order.orderNumber)}
                  </td>
                  <td className="px-5 py-3.5 font-medium">{order.accountName}</td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_CLASSES[order.status]}`}
                    >
                      {ORDER_STATUS_LABELS[order.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-muted">{fulfillmentLabel(order.status)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                    {formatOrderDate(order.createdAt)}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums">
                    {formatGbp(order.totalMinor)}
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
