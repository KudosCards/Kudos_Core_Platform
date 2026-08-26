import { Suspense } from "react";
import Link from "next/link";
import { Cake, Calendar, Contact, type LucideIcon } from "lucide-react";
import type { Account, DashboardSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { formatGbp } from "@/lib/orders";
import { Skeleton } from "@/components/skeleton";
import { GetStartedChecklist } from "./get-started-checklist";

interface StatCard {
  label: string;
  value: string;
  href: string;
  hint?: string;
}

/**
 * The page shell is a plain (non-async) component so it returns immediately:
 * the static "next steps" card paints in the first flush while the data-backed
 * overview (account greeting + stat tiles) streams into its Suspense boundary.
 * On a hard load that means real content on screen sooner than blocking the
 * whole route on the summary query. See docs/adr/0043-streaming.md.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<DashboardOverviewSkeleton />}>
        <DashboardOverview />
      </Suspense>

      <QuickActions />

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

/** The three things a subscriber most often wants to do, front and centre — the
 * quickest paths to sending a card. Static, so it paints in the first flush. */
function QuickActions() {
  const actions: {
    href: string;
    label: string;
    sub: string;
    Icon: LucideIcon;
    primary?: boolean;
  }[] = [
    {
      href: "/send",
      label: "Send a card",
      sub: "Pick a design, add a contact, pay",
      Icon: Cake,
      primary: true,
    },
    {
      href: "/get-started",
      label: "Upload contacts",
      sub: "Import your list from a CSV",
      Icon: Contact,
    },
    {
      href: "/calendar",
      label: "View calendar",
      sub: "Upcoming birthdays & dispatches",
      Icon: Calendar,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className={`group flex items-center gap-3 rounded-xl border p-4 transition-colors ${
            action.primary
              ? "border-accent/30 bg-accent-soft hover:border-accent/50"
              : "border-border hover:border-foreground/20 hover:bg-foreground/[0.02]"
          }`}
        >
          <action.Icon
            className={`h-6 w-6 shrink-0 ${action.primary ? "text-accent" : "text-muted"}`}
            aria-hidden
          />
          <span className="flex flex-col">
            <span className={`font-semibold ${action.primary ? "text-accent" : ""}`}>
              {action.label}
            </span>
            <span className="text-xs text-muted">{action.sub}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

async function DashboardOverview() {
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
      label: "Contacts",
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
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Welcome, {account?.name}</h1>
        <p className="text-muted">
          Here&apos;s what&apos;s happening with your recognition programme.
        </p>
      </div>

      {summary && (
        <GetStartedChecklist
          recipientCount={summary.recipientCount}
          hasOccasions={summary.hasOccasions}
          firstOrderPlaced={summary.firstOrderPlaced}
        />
      )}

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

      {(summary?.contactsMissingAddress ?? 0) > 0 && (
        <div className="flex flex-col gap-4 rounded-xl border border-warning/30 bg-warning-soft p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-foreground">
              {summary!.contactsMissingAddress} contact
              {summary!.contactsMissingAddress === 1 ? "" : "s"} need
              {summary!.contactsMissingAddress === 1 ? "s" : ""} an address
            </p>
            <p className="text-sm text-warning">
              We post real cards, so these can&apos;t be sent until an address is added.
            </p>
          </div>
          <Link
            href="/recipients?missingAddress=true"
            className="shrink-0 rounded-full bg-warning px-4 py-2 text-sm font-semibold text-white hover:bg-warning/90"
          >
            Add addresses <span aria-hidden>→</span>
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
    </>
  );
}

/** Greeting + 6-tile stat grid silhouette, shown while the overview streams. */
function DashboardOverviewSkeleton() {
  return (
    <>
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card flex flex-col gap-2 p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </>
  );
}
