"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatGbp, formatOrderDate } from "@/lib/orders";
import {
  HEALTH_CLASSES,
  HEALTH_LABELS,
  PLAN_LABELS,
  planLabel,
  type AccountHealth,
} from "@/lib/admin";

export interface AdminSubscriberRow {
  id: string;
  name: string;
  type: string;
  plan: string;
  health: AccountHealth;
  createdAt: string;
  lastActivityAt: string;
  orderCount: number;
  cardsSent: number;
  totalSpentMinor: number;
  recipientCount: number;
  hasStripeCustomer: boolean;
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

const PLAN_OPTIONS = Object.entries(PLAN_LABELS); // [["free","Free"], ...]
const HEALTH_OPTIONS: Exclude<AccountHealth, "none">[] = ["active", "at_risk", "churned"];

function toCsv(rows: AdminSubscriberRow[]): string {
  const header = [
    "Account",
    "Type",
    "Plan",
    "Status",
    "Joined",
    "Contacts",
    "Orders",
    "Cards sent",
    "Spent (£)",
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.name,
      r.type,
      planLabel(r.plan),
      r.health === "none" ? "" : HEALTH_LABELS[r.health],
      formatOrderDate(r.createdAt),
      String(r.recipientCount),
      String(r.orderCount),
      String(r.cardsSent),
      (r.totalSpentMinor / 100).toFixed(2),
    ]
      .map((c) => escape(c))
      .join(","),
  );
  return [header.map(escape).join(","), ...lines].join("\n");
}

export function AdminSubscribersClient({
  initialSubscribers,
  total,
  page,
  perPage,
  search,
  plan,
  health,
}: {
  initialSubscribers: AdminSubscriberRow[];
  total: number;
  page: number;
  perPage: number;
  search: string;
  plan: string;
  health: AccountHealth | "all";
}) {
  const router = useRouter();
  // The current page's rows are exactly what the server returned; no in-memory
  // filtering — search/plan/health/pagination are all resolved server-side.
  const rows = initialSubscribers;
  const [searchInput, setSearchInput] = useState(search);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const firstRender = useRef(true);

  // Push the search term into the URL (server re-queries) after the user pauses,
  // resetting to page 1. Guarded so seeding the input doesn't fire a navigation.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const handle = setTimeout(() => navigate({ search: searchInput, page: 1 }), 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function navigate(next: {
    search?: string;
    plan?: string;
    health?: AccountHealth | "all";
    page?: number;
  }) {
    const params = new URLSearchParams();
    const nextSearch = next.search ?? searchInput;
    const nextPlan = next.plan ?? plan;
    const nextHealth = next.health ?? health;
    const nextPage = next.page ?? page;
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    if (nextPlan && nextPlan !== "all") params.set("plan", nextPlan);
    if (nextHealth && nextHealth !== "all") params.set("health", nextHealth);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.push(qs ? `/admin/subscribers?${qs}` : "/admin/subscribers");
  }

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function exportCsv() {
    // Export the current selection, or this page's rows if nothing is selected.
    const out = selectedRows.length > 0 ? selectedRows : rows;
    const blob = new Blob([toCsv(out)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kudos-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Customers</h1>
          <p className="text-sm text-muted">
            Every account on the platform · {total.toLocaleString("en-GB")} total
            {total > 0 && (
              <>
                , showing {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")}
              </>
            )}
            . Select a customer to see their engagement.
          </p>
        </div>
        <button type="button" onClick={exportCsv} className="btn-secondary text-sm">
          Export CSV{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name"
          className={`${inputClass} sm:max-w-xs`}
        />
        <select
          value={plan}
          onChange={(e) => navigate({ plan: e.target.value, page: 1 })}
          className={`${inputClass} sm:max-w-40`}
        >
          <option value="all">All plans</option>
          {PLAN_OPTIONS.map(([value, labelText]) => (
            <option key={value} value={value}>
              {labelText}
            </option>
          ))}
        </select>
        <select
          value={health}
          onChange={(e) => navigate({ health: e.target.value as AccountHealth | "all", page: 1 })}
          className={`${inputClass} sm:max-w-40`}
        >
          <option value="all">All statuses</option>
          {HEALTH_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {HEALTH_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border p-6 text-sm text-muted">
          No accounts match your filters.
        </p>
      ) : (
        <>
          {/* Table on ≥sm; a stacked-card list replaces it on phones so this wide
              9-column row never becomes a sideways-scrolling wall. */}
          <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 text-right font-medium">Contacts</th>
                <th className="px-4 py-3 text-right font-medium">Orders</th>
                <th className="px-4 py-3 text-right font-medium">Cards sent</th>
                <th className="px-4 py-3 text-right font-medium">Spent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-foreground/[0.02]">
                  <td className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.name}`}
                    />
                  </td>
                  <td className="px-4 py-3.5">
                    <Link href={`/admin/subscribers/${row.id}`} className="flex flex-col group">
                      <span className="font-medium group-hover:text-accent">{row.name}</span>
                      <span className="text-xs text-muted capitalize">{row.type}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">{planLabel(row.plan)}</td>
                  <td className="px-4 py-3.5">
                    {row.health !== "none" && (
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_CLASSES[row.health]}`}
                      >
                        {HEALTH_LABELS[row.health]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-muted">
                    {formatOrderDate(row.createdAt)}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-muted">
                    {row.recipientCount}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-muted">{row.orderCount}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-muted">{row.cardsSent}</td>
                  <td className="px-4 py-3.5 text-right font-semibold tabular-nums">
                    {formatGbp(row.totalSpentMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div className="flex flex-col gap-3 sm:hidden">
            {/* Mobile counterpart to the table's header select-all checkbox. */}
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex min-h-11 items-center self-start text-sm font-medium text-accent"
            >
              {allSelected ? "Clear selection" : "Select all"}
            </button>
            {rows.map((row) => (
              <div key={row.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start gap-3">
                  <label className="flex min-h-11 min-w-11 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      aria-label={`Select ${row.name}`}
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/subscribers/${row.id}`} className="group flex flex-col">
                      <span className="font-medium group-hover:text-accent">{row.name}</span>
                      <span className="text-xs text-muted capitalize">{row.type}</span>
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span>{planLabel(row.plan)}</span>
                      {row.health !== "none" && (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 font-medium ${HEALTH_CLASSES[row.health]}`}
                        >
                          {HEALTH_LABELS[row.health]}
                        </span>
                      )}
                      <span aria-hidden>·</span>
                      <span>Joined {formatOrderDate(row.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-center min-[380px]:grid-cols-4">
                  <div>
                    <dt className="text-[11px] text-muted">Contacts</dt>
                    <dd className="text-sm tabular-nums">{row.recipientCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">Orders</dt>
                    <dd className="text-sm tabular-nums">{row.orderCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">Cards</dt>
                    <dd className="text-sm tabular-nums">{row.cardsSent}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">Spent</dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {formatGbp(row.totalSpentMinor)}
                    </dd>
                  </div>
                </dl>
              </div>
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
