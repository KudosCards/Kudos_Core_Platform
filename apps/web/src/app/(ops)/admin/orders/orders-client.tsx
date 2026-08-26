"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BatchOrderStatus, OrderFulfillmentProgress } from "@kudos/shared-types";
import {
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  formatGbp,
  formatOrderDate,
} from "@/lib/orders";
import { formatOrderNumber } from "@/lib/admin";

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
  progress: OrderFulfillmentProgress;
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

/** How many cards are physically done (posted or delivered) — the numerator of
 * the "340/2,000" progress readout. */
function doneCount(p: OrderFulfillmentProgress): number {
  return p.posted + p.delivered;
}

/** A compact real-progress cell: "340/2,000 posted" with a bar, or a dash when
 * the order has no fulfilment jobs yet (not paid). See ADR 0109. */
function ProgressCell({ progress }: { progress: OrderFulfillmentProgress }) {
  if (progress.total === 0) {
    return <span className="text-muted">—</span>;
  }
  const done = doneCount(progress);
  const pct = Math.round((done / progress.total) * 100);
  return (
    <div className="flex min-w-[120px] flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="tabular-nums">
          {done.toLocaleString("en-GB")}/{progress.total.toLocaleString("en-GB")} posted
        </span>
        {progress.importErrors > 0 && (
          <span
            title={`${progress.importErrors} Click & Drop import error(s)`}
            className="rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800"
          >
            ⚠ {progress.importErrors}
          </span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${pct}%` }}
          aria-label={`${pct}% posted`}
        />
      </div>
    </div>
  );
}

export function AdminOrdersClient({
  initialOrders,
  total,
  page,
  perPage,
  status,
  search,
}: {
  initialOrders: AdminOrderRow[];
  total: number;
  page: number;
  perPage: number;
  status: BatchOrderStatus | "all";
  search: string;
}) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(search);
  const firstRender = useRef(true);

  // Push the search term into the URL (server re-queries) after the user pauses,
  // resetting to page 1. Guarded so seeding the input doesn't fire a navigation.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const handle = setTimeout(() => {
      navigate({ search: searchInput, page: 1 });
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function navigate(next: { status?: BatchOrderStatus | "all"; search?: string; page?: number }) {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextSearch = next.search ?? searchInput;
    const nextPage = next.page ?? page;
    if (nextStatus && nextStatus !== "all") params.set("status", nextStatus);
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.push(qs ? `/admin/orders?${qs}` : "/admin/orders");
  }

  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Orders</h1>
        <p className="text-sm text-muted">
          Every order across all accounts · {total.toLocaleString("en-GB")} total
          {total > 0 && (
            <>
              , showing {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")}
            </>
          )}
          .
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by account or order id"
          className={`${inputClass} sm:max-w-xs`}
        />
        <select
          value={status}
          onChange={(e) =>
            navigate({ status: e.target.value as BatchOrderStatus | "all", page: 1 })
          }
          className={`${inputClass} sm:max-w-xs`}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All statuses" : ORDER_STATUS_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      {initialOrders.length === 0 ? (
        <p className="rounded-xl border border-border p-6 text-sm text-muted">
          No orders match your filters.
        </p>
      ) : (
        <>
          {/* Table on ≥sm; a stacked-card list replaces it on phones so the row
              never becomes a sideways-scrolling wall. Rows link to the order. */}
          <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                  <th className="px-5 py-3 font-medium">Order</th>
                  <th className="px-5 py-3 font-medium">Account</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Progress</th>
                  <th className="px-5 py-3 font-medium">Placed</th>
                  <th className="px-5 py-3 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {initialOrders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => router.push(`/admin/orders/${order.id}`)}
                    className="cursor-pointer hover:bg-foreground/[0.02]"
                  >
                    <td className="px-5 py-3.5 font-semibold whitespace-nowrap tabular-nums">
                      <Link href={`/admin/orders/${order.id}`} className="hover:text-accent">
                        {formatOrderNumber(order.orderNumber)}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 font-medium">{order.accountName}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_CLASSES[order.status]}`}
                      >
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <ProgressCell progress={order.progress} />
                    </td>
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
          </div>

          <div className="flex flex-col gap-3 sm:hidden">
            {initialOrders.map((order) => (
              <Link
                key={order.id}
                href={`/admin/orders/${order.id}`}
                className="rounded-xl border border-border p-4 hover:bg-foreground/[0.02]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold tabular-nums">
                      {formatOrderNumber(order.orderNumber)}
                    </p>
                    <p className="truncate text-sm font-medium">{order.accountName}</p>
                  </div>
                  <p className="shrink-0 text-right font-semibold tabular-nums">
                    {formatGbp(order.totalMinor)}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 font-medium ${ORDER_STATUS_CLASSES[order.status]}`}
                  >
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                  {order.progress.total > 0 && (
                    <span className="tabular-nums">
                      {doneCount(order.progress).toLocaleString("en-GB")}/
                      {order.progress.total.toLocaleString("en-GB")} posted
                    </span>
                  )}
                  <span aria-hidden>·</span>
                  <span>{formatOrderDate(order.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => navigate({ page: page - 1 })}
                className="rounded-lg border border-border px-4 py-1.5 hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-muted tabular-nums">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => navigate({ page: page + 1 })}
                className="rounded-lg border border-border px-4 py-1.5 hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
