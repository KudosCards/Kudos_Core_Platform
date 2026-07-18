import Link from "next/link";
import type { Account, DashboardSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { formatGbp } from "@/lib/orders";

interface StatCard {
  label: string;
  value: string;
  href: string;
  hint?: string;
}

export default async function DashboardPage() {
  // Degrade gracefully on a transient failure rather than hitting Next's error
  // boundary — every field below is rendered optionally.
  const [account, summary] = await Promise.all([
    serverApiFetch<Account>("/accounts/me").catch(() => null),
    serverApiFetch<DashboardSummary>("/accounts/me/summary").catch(() => null),
  ]);

  const pendingApprovals = summary?.pendingApprovals ?? 0;

  const stats: StatCard[] = [
    {
      label: "Waiting for approval",
      value: String(pendingApprovals),
      href: "/approvals",
      hint: "Review and send",
    },
    {
      label: "Occasions this month",
      value: String(summary?.occasionsThisMonth ?? 0),
      href: "/calendar",
      hint: "See the calendar",
    },
    {
      label: "Active orders",
      value: String(summary?.activeOrders ?? 0),
      href: "/orders",
      hint: "In production or unpaid",
    },
    {
      label: "Wallet balance",
      value: formatGbp(summary?.walletBalanceMinor ?? 0),
      href: "/wallet",
      hint: "Top up",
    },
    {
      label: "Recipients",
      value: String(summary?.recipientCount ?? 0),
      href: "/recipients",
      hint: "Manage list",
    },
    {
      label: "Completed orders",
      value: String(summary?.completedOrders ?? 0),
      href: "/orders",
      hint: "View history",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Welcome, {account?.name}</h1>
        <p className="text-muted">Here&apos;s what&apos;s happening with your recognition programme.</p>
      </div>

      {pendingApprovals > 0 && (
        <div className="flex flex-col gap-4 rounded-xl border border-accent/20 bg-accent-soft p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-accent">
              {pendingApprovals} occasion{pendingApprovals === 1 ? "" : "s"} need
              {pendingApprovals === 1 ? "s" : ""} your approval
            </p>
            <p className="text-sm text-accent/80">Review them now so cards go to print in time.</p>
          </div>
          <Link href="/approvals" className="btn-accent shrink-0">
            Review <span aria-hidden>→</span>
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="card group flex flex-col gap-2 p-5 transition-colors hover:border-foreground/20"
          >
            <p className="section-label">{stat.label}</p>
            <p className="text-3xl font-bold tracking-tight">{stat.value}</p>
            {stat.hint && (
              <p className="text-sm font-medium text-accent group-hover:underline">{stat.hint}</p>
            )}
          </Link>
        ))}
      </div>

      <div className="card p-5">
        <p className="font-semibold">Get cards out the door</p>
        <p className="mt-1 text-sm text-muted">
          Approve upcoming occasions, then either{" "}
          <Link href="/batch-orders" className="text-accent hover:underline">
            check out
          </Link>{" "}
          to pay, or turn on auto-send at approval to have us order, pay, and post them for you.
        </p>
      </div>
    </div>
  );
}
