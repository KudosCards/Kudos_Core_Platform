import { serverApiFetch } from "@/lib/api.server";
import { formatGbp } from "@/lib/orders";
import { planLabel } from "@/lib/admin";

interface AdminOverview {
  accounts: { total: number; organisations: number; individuals: number };
  subscribersByPlan: { plan: string; count: number }[];
  activeSubscriptions: number;
  atRiskCount: number;
  orders: { paid: number; last30Days: number };
  revenueMinor: { allTime: number; last30Days: number };
  monthlyRevenueMinor: { label: string; minor: number }[];
  cardsSent: number;
  funnel: { signedUp: number; placedFirstOrder: number; cardsFulfilled: number };
  needsAttention: { id: string; name: string; lastActivityDays: number }[];
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "accent" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className={`mt-1 text-3xl font-bold tracking-tight ${tone === "accent" ? "text-accent" : ""}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Panel({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">{title}</h2>
        {right && <span className="text-sm font-semibold">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function RevenueChart({ data }: { data: { label: string; minor: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.minor));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-40 items-end gap-1.5">
        {data.map((month, i) => {
          const isLast = i === data.length - 1;
          const heightPct = Math.max(2, Math.round((month.minor / max) * 100));
          return (
            <div
              key={i}
              title={`${month.label}: ${formatGbp(month.minor)}`}
              className={`flex-1 rounded-t ${isLast ? "bg-accent" : "bg-accent/25"}`}
              style={{ height: `${heightPct}%` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const overview = await serverApiFetch<AdminOverview>("/admin/overview");
  if (!overview) {
    return <p className="text-sm text-muted">Couldn&apos;t load the dashboard.</p>;
  }

  const planMax = Math.max(1, ...overview.subscribersByPlan.map((p) => p.count));
  const funnelMax = Math.max(1, overview.funnel.signedUp);
  const funnelStages = [
    { label: "Signed up", value: overview.funnel.signedUp },
    { label: "Placed first order", value: overview.funnel.placedFirstOrder },
    { label: "Cards fulfilled", value: overview.funnel.cardsFulfilled },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dashboard</h1>
        <p className="text-sm text-muted">A live view of the whole Kudos Cards platform.</p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Revenue (all time)"
          value={formatGbp(overview.revenueMinor.allTime)}
          sub={`${formatGbp(overview.revenueMinor.last30Days)} in the last 30 days`}
        />
        <Stat
          label="Active subscriptions"
          value={overview.activeSubscriptions.toLocaleString("en-GB")}
          sub={`${overview.accounts.total.toLocaleString("en-GB")} accounts total`}
        />
        <Stat
          label="Cards sent"
          value={overview.cardsSent.toLocaleString("en-GB")}
          sub={`${overview.orders.last30Days.toLocaleString("en-GB")} orders in the last 30 days`}
        />
        <Stat
          label="At-risk accounts"
          value={overview.atRiskCount.toLocaleString("en-GB")}
          sub={`of ${overview.accounts.total.toLocaleString("en-GB")} total accounts`}
          tone={overview.atRiskCount > 0 ? "accent" : undefined}
        />
      </div>

      {/* Revenue chart + plans */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Revenue, last 12 months" right={`${formatGbp(overview.revenueMinor.allTime)} total`}>
            <RevenueChart data={overview.monthlyRevenueMinor} />
          </Panel>
        </div>
        <Panel title="Accounts by plan">
          {overview.subscribersByPlan.length === 0 ? (
            <p className="text-sm text-muted">No accounts yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {overview.subscribersByPlan.map((row) => (
                <Meter key={row.plan} label={planLabel(row.plan)} value={row.count} max={planMax} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Funnel + needs attention */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Signup → first order → fulfillment funnel">
            <div className="flex flex-col gap-3">
              {funnelStages.map((stage) => (
                <div key={stage.label} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-sm">{stage.label}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-md bg-foreground/[0.06]">
                    <div
                      className="h-full rounded-md bg-accent"
                      style={{ width: `${Math.round((stage.value / funnelMax) * 100)}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {stage.value}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
        <Panel title="Needs attention">
          {overview.needsAttention.length === 0 ? (
            <p className="text-sm text-muted">Nothing to flag — all accounts are active.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {overview.needsAttention.map((account) => (
                <div key={account.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold">{account.name}</span>
                    <span className="text-xs text-muted">
                      Last activity {account.lastActivityDays} day{account.lastActivityDays === 1 ? "" : "s"} ago
                    </span>
                  </div>
                  <span className="shrink-0 rounded-full border border-accent/40 px-2 py-0.5 text-xs font-medium text-accent">
                    At-risk
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
