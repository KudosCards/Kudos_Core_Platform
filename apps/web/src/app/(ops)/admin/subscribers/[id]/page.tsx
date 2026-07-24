import Link from "next/link";
import { notFound } from "next/navigation";
import type { Customer360 } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { formatGbp, formatOrderDate, ORDER_STATUS_CLASSES, ORDER_STATUS_LABELS } from "@/lib/orders";
import { HEALTH_CLASSES, HEALTH_LABELS, formatOrderNumber, planLabel } from "@/lib/admin";
import type { BatchOrderStatus } from "@kudos/shared-types";

const ENGAGEMENT: Record<
  Customer360["engagement"]["level"],
  { label: string; className: string }
> = {
  activated: { label: "Activated", className: "bg-[#e8f1ea] text-[#2f7d54]" },
  onboarding: { label: "Onboarding", className: "bg-[#fff4e5] text-[#a8630a]" },
  dormant: { label: "Dormant", className: "bg-foreground/[0.07] text-muted" },
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Added by hand",
  csv: "CSV import",
  api: "API / Zapier",
  brevo: "Brevo",
  hubspot: "HubSpot",
};
const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let customer: Customer360 | null;
  try {
    customer = await serverApiFetch<Customer360>(`/admin/customers/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
  if (!customer) notFound();

  const engagement = ENGAGEMENT[customer.engagement.level];
  const signalRows: { label: string; on: boolean }[] = [
    { label: "Contacts added", on: customer.engagement.signals.hasContacts },
    { label: "Events scheduled", on: customer.engagement.signals.hasOccasions },
    { label: "Integration connected", on: customer.engagement.signals.hasIntegration },
    { label: "Placed an order", on: customer.engagement.signals.hasOrder },
    { label: "Team members", on: customer.engagement.signals.hasTeam },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/subscribers" className="text-sm text-muted hover:text-foreground">
          ← All customers
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{customer.name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${engagement.className}`}>
            {engagement.label}
          </span>
          {customer.health !== "none" && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${HEALTH_CLASSES[customer.health]}`}
            >
              {HEALTH_LABELS[customer.health]}
            </span>
          )}
        </div>
        <p className="text-sm text-muted">
          <span className="capitalize">{customer.type}</span> · {planLabel(customer.plan)} plan ·
          Joined {formatOrderDate(customer.createdAt)} · Last active{" "}
          {formatOrderDate(customer.lastActivityAt)}
          {customer.contactEmail ? ` · ${customer.contactEmail}` : ""}
        </p>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Total spent" value={formatGbp(customer.orders.totalSpentMinor)} />
        <Tile label="Orders" value={String(customer.orders.count)} />
        <Tile label="Cards sent" value={String(customer.orders.cardsSent)} />
        <Tile label="Contacts" value={String(customer.contacts.total)} />
        <Tile label="Wallet" value={formatGbp(customer.wallet.balanceMinor)} />
        <Tile label="Message views" value={String(customer.messages.totalViews)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Engagement */}
        <Panel title="Engagement">
          <ul className="flex flex-col gap-2">
            {signalRows.map((s) => (
              <li key={s.label} className="flex items-center justify-between text-sm">
                <span>{s.label}</span>
                <span className={s.on ? "text-[#2f7d54]" : "text-muted"}>{s.on ? "✓ Yes" : "— No"}</span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Contacts */}
        <Panel title="Contacts">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Stat label="Active" value={customer.contacts.active} />
            <Stat label="Lapsed" value={customer.contacts.lapsed} />
            <Stat label="Archived" value={customer.contacts.archived} />
            <Stat label="Lists" value={customer.contacts.listCount} />
            <Stat label="Needs address" value={customer.contacts.needsAddress} />
          </div>
          {customer.contacts.bySource.length > 0 && (
            <div className="mt-4 flex flex-col gap-1.5">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">By source</p>
              {customer.contacts.bySource.map((s) => (
                <div key={s.source} className="flex justify-between text-sm">
                  <span>{sourceLabel(s.source)}</span>
                  <span className="tabular-nums text-muted">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Events / occasions */}
        <Panel title="Scheduled events">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="Scheduled" value={customer.occasions.scheduled} />
            <Stat label="Auto-send" value={customer.occasions.autoSend} />
          </div>
          {customer.occasions.upcoming.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1.5 text-sm">
              {customer.occasions.upcoming.map((o, i) => (
                <li key={i} className="flex justify-between">
                  <span>{o.label}</span>
                  <span className="text-muted">{o.date ? formatOrderDate(o.date) : "—"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">No upcoming events.</p>
          )}
        </Panel>

        {/* Integrations */}
        <Panel title="Integrations">
          {customer.integrations.crm.length === 0 && customer.integrations.apiKeys.length === 0 ? (
            <p className="text-sm text-muted">No integrations connected.</p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              {customer.integrations.crm.map((c) => (
                <div key={c.provider} className="flex items-center justify-between">
                  <span className="capitalize">{c.provider}</span>
                  <span className="text-muted">
                    {c.syncEnabled ? "Syncing" : "Paused"}
                    {c.lastSyncedAt ? ` · ${formatOrderDate(c.lastSyncedAt)}` : ""}
                  </span>
                </div>
              ))}
              {customer.integrations.apiKeys.map((k) => (
                <div key={k.prefix} className="flex items-center justify-between">
                  <span>
                    API key <span className="text-muted">({k.label})</span>
                  </span>
                  <span className="text-muted">
                    {k.revoked ? "Revoked" : k.lastUsedAt ? `Used ${formatOrderDate(k.lastUsedAt)}` : "Never used"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Team */}
        <Panel title="Team & seats">
          <p className="text-sm">
            <span className="font-semibold">{customer.team.memberCount}</span> of{" "}
            <span className="font-semibold">{customer.team.seatLimit}</span> seats used
            {customer.team.pendingInvites > 0 && (
              <span className="text-muted"> · {customer.team.pendingInvites} pending</span>
            )}
          </p>
          {customer.team.members.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {customer.team.members.map((m, i) => (
                <li key={i} className="flex justify-between">
                  <span className="truncate">{m.email ?? "—"}</span>
                  <span className="capitalize text-muted">{m.role}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Billing */}
        <Panel title="Billing">
          <div className="flex flex-col gap-2 text-sm">
            <Row label="Subscription">
              {customer.subscription ? (
                <span className="capitalize">
                  {customer.subscription.plan} · {customer.subscription.status.replace(/_/g, " ")}
                </span>
              ) : (
                <span className="text-muted">None</span>
              )}
            </Row>
            {customer.subscription && (
              <Row label="Renews">{formatOrderDate(customer.subscription.currentPeriodEnd)}</Row>
            )}
            <Row label="Stripe customer">{customer.hasStripeCustomer ? "Yes" : "No"}</Row>
            <Row label="Wallet balance">{formatGbp(customer.wallet.balanceMinor)}</Row>
            <Row label="Saved designs">{String(customer.designs.savedCount)}</Row>
            <Row label="Reminder emails">{customer.reminderEmailsEnabled ? "On" : "Off"}</Row>
            <Row label="Returns">
              {customer.returns.total === 0
                ? "None"
                : `${customer.returns.open} open · ${customer.returns.total} total`}
            </Row>
          </div>
        </Panel>
      </div>

      {/* Recent orders */}
      <Panel title="Recent orders">
        {customer.orders.recent.length === 0 ? (
          <p className="text-sm text-muted">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                  <th className="py-2 pr-4 font-medium">Order</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 text-right font-medium">Cards</th>
                  <th className="py-2 pr-4 text-right font-medium">Total</th>
                  <th className="py-2 pr-4 font-medium">Payment</th>
                  <th className="py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customer.orders.recent.map((o) => (
                  <tr key={o.id}>
                    <td className="py-2.5 pr-4 font-medium">{formatOrderNumber(o.orderNumber)}</td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ORDER_STATUS_CLASSES[o.status as BatchOrderStatus]}`}
                      >
                        {ORDER_STATUS_LABELS[o.status as BatchOrderStatus]}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-muted">{o.cardCount}</td>
                    <td className="py-2.5 pr-4 text-right font-semibold tabular-nums">
                      {formatGbp(o.totalMinor)}
                    </td>
                    <td className="py-2.5 pr-4 capitalize text-muted">{o.paymentMethod ?? "—"}</td>
                    <td className="py-2.5 whitespace-nowrap text-muted">{formatOrderDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-5">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-foreground/[0.03] px-3 py-2">
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
