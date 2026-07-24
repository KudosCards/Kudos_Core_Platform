"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
}: {
  initialSubscribers: AdminSubscriberRow[];
  total: number;
}) {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState<string>("all");
  const [health, setHealth] = useState<AccountHealth | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialSubscribers.filter((row) => {
      if (plan !== "all" && row.plan !== plan) return false;
      if (health !== "all" && row.health !== health) return false;
      if (q && !row.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initialSubscribers, search, plan, health]);

  const selectedRows = filtered.filter((r) => selected.has(r.id));
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.id)));
  }

  function exportCsv() {
    const rows = selectedRows.length > 0 ? selectedRows : filtered;
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kudos-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Customers</h1>
          <p className="text-sm text-muted">
            Every account on the platform · {total.toLocaleString("en-GB")} total,{" "}
            {filtered.length.toLocaleString("en-GB")} shown. Select a customer to see their
            engagement.
          </p>
        </div>
        <button type="button" onClick={exportCsv} className="btn-secondary text-sm">
          Export CSV{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name"
          className={`${inputClass} sm:max-w-xs`}
        />
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className={`${inputClass} sm:max-w-40`}>
          <option value="all">All plans</option>
          {PLAN_OPTIONS.map(([value, labelText]) => (
            <option key={value} value={value}>
              {labelText}
            </option>
          ))}
        </select>
        <select
          value={health}
          onChange={(e) => setHealth(e.target.value as AccountHealth | "all")}
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

      <div className="overflow-x-auto rounded-xl border border-border">
        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted">No accounts match your filters.</p>
        ) : (
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
              {filtered.map((row) => (
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
        )}
      </div>
    </div>
  );
}
