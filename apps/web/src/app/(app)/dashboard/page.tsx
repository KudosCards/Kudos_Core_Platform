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

  const stats: StatCard[] = [
    {
      label: "Waiting for approval",
      value: String(summary?.pendingApprovals ?? 0),
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
    },
    {
      label: "Completed orders",
      value: String(summary?.completedOrders ?? 0),
      href: "/orders",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Welcome, {account?.name}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="flex flex-col gap-1 rounded-lg border border-black/10 p-5 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20"
          >
            <p className="text-sm text-foreground/60">{stat.label}</p>
            <p className="text-3xl font-semibold">{stat.value}</p>
            {stat.hint && <p className="text-xs text-foreground/40">{stat.hint}</p>}
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-black/10 p-5 dark:border-white/10">
        <p className="font-medium">Get cards out the door</p>
        <p className="mt-1 text-sm text-foreground/60">
          Approve upcoming occasions, then either{" "}
          <Link href="/batch-orders" className="underline">
            check out
          </Link>{" "}
          to pay, or turn on auto-send at approval to have us order, pay, and post them for you.
        </p>
      </div>
    </div>
  );
}
