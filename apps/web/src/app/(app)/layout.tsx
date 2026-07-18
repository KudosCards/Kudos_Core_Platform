import { redirect } from "next/navigation";
import Link from "next/link";
import type { Account, DashboardSummary } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { formatGbp } from "@/lib/orders";
import { SidebarNav } from "./sidebar-nav";
import { LogoutButton } from "./logout-button";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Account is required (its 403 means "no membership yet" → onboarding); the
  // summary is best-effort and only feeds the sidebar badge + wallet chip, so a
  // transient failure there degrades gracefully rather than blocking the shell.
  const [accountResult, summary] = await Promise.all([
    serverApiFetch<Account>("/accounts/me").catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 403) {
        redirect("/onboarding");
      }
      throw error;
    }),
    serverApiFetch<DashboardSummary>("/accounts/me/summary").catch(() => null),
  ]);
  if (!accountResult) {
    redirect("/login");
  }
  const account = accountResult;
  const planLabel = account.planId
    ? `${account.planId.charAt(0).toUpperCase()}${account.planId.slice(1)} plan`
    : "No plan";

  return (
    <div className="flex flex-1">
      <aside className="flex w-64 shrink-0 flex-col justify-between border-r border-border bg-surface px-4 py-6">
        <div className="flex flex-col gap-8">
          <div className="px-3">
            <p className="text-lg font-bold tracking-tight">Kudos Cards</p>
            <p className="text-xs text-muted">Recognition, delivered</p>
          </div>
          <SidebarNav pendingApprovals={summary?.pendingApprovals ?? 0} />
        </div>
        <div className="mt-6 flex flex-col gap-2 border-t border-border px-3 pt-4">
          <span className="truncate text-sm font-semibold">{account.name}</span>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span>{planLabel}</span>
            <span aria-hidden>·</span>
            <Link href="/billing" className="text-accent hover:underline">
              manage
            </Link>
          </div>
          <div className="pt-1">
            <LogoutButton />
          </div>
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-border bg-surface px-8 py-3.5">
          <span className="text-sm text-muted">
            Wallet:{" "}
            <span className="font-semibold text-foreground">
              {formatGbp(summary?.walletBalanceMinor ?? 0)}
            </span>
          </span>
          <Link href="/batch-orders" className="btn-accent">
            Create an order <span aria-hidden>→</span>
          </Link>
        </header>
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
