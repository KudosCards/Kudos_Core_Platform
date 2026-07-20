import { serverApiFetch } from "@/lib/api.server";
import { formatGbp } from "@/lib/orders";

interface AdminOverview {
  accounts: { total: number; organisations: number; individuals: number };
  subscribersByPlan: { plan: string; count: number }[];
  activeSubscriptions: number;
  orders: { paid: number; last30Days: number };
  revenueMinor: { allTime: number; last30Days: number };
  cardsSent: number;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-black/10 p-5 dark:border-white/10">
      <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-foreground/50">{sub}</p>}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const overview = await serverApiFetch<AdminOverview>("/admin/overview");

  if (!overview) {
    return <p className="text-sm text-foreground/60">Couldn&apos;t load the dashboard.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
        <p className="text-sm text-foreground/60">A live view of the whole Kudos Cards platform.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Revenue (all time)"
          value={formatGbp(overview.revenueMinor.allTime)}
          sub={`${formatGbp(overview.revenueMinor.last30Days)} in the last 30 days`}
        />
        <Stat
          label="Paid orders"
          value={overview.orders.paid.toLocaleString("en-GB")}
          sub={`${overview.orders.last30Days.toLocaleString("en-GB")} in the last 30 days`}
        />
        <Stat label="Cards sent" value={overview.cardsSent.toLocaleString("en-GB")} />
        <Stat
          label="Accounts"
          value={overview.accounts.total.toLocaleString("en-GB")}
          sub={`${overview.accounts.organisations} centres · ${overview.accounts.individuals} individuals`}
        />
        <Stat
          label="Active subscriptions"
          value={overview.activeSubscriptions.toLocaleString("en-GB")}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Accounts by plan</h2>
        <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
          {overview.subscribersByPlan.length === 0 ? (
            <p className="p-5 text-sm text-foreground/60">No accounts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {overview.subscribersByPlan.map((row) => (
                  <tr key={row.plan}>
                    <td className="px-5 py-3 font-medium capitalize">{row.plan}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-foreground/70">
                      {row.count.toLocaleString("en-GB")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
