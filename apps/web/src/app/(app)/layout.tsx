import { redirect } from "next/navigation";
import { planDisplayName, type Account, type NavBadges } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { cachedServerApiFetch, serverApiFetch } from "@/lib/api.server";
import { formatGbp } from "@/lib/orders";
import { AppShell } from "./app-shell";

// The account (name + plan) changes rarely, so cache it per-user for a minute:
// the shell no longer re-queries it on every navigation once warm. The badges
// stay live (below). See docs/adr/0076-app-shell-perf.md.
const ACCOUNT_CACHE_SECONDS = 60;

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Account is required (its 403 means "no membership yet" → onboarding); the
  // nav badges are best-effort and only feed the sidebar badge + wallet chip, so
  // a transient failure there degrades gracefully rather than blocking the shell.
  // Deliberately the *tiny* /nav-badges (3 counts) — the shell runs this on every
  // navigation, so it must not pay for the full dashboard aggregation. See ADR
  // 0072-perf.
  const [accountResult, badges] = await Promise.all([
    cachedServerApiFetch<Account>("/accounts/me", ACCOUNT_CACHE_SECONDS).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 403) {
        redirect("/onboarding");
      }
      throw error;
    }),
    serverApiFetch<NavBadges>("/accounts/me/nav-badges").catch(() => null),
  ]);
  if (!accountResult) {
    redirect("/login");
  }
  const account = accountResult;
  const planLabel = account.planId ? `${planDisplayName(account.planId)} plan` : "No plan";

  return (
    <AppShell
      accountName={account.name}
      planLabel={planLabel}
      pendingApprovals={badges?.pendingApprovals ?? 0}
      unfinishedOrders={badges?.unfinishedOrders ?? 0}
      walletLabel={formatGbp(badges?.walletBalanceMinor ?? 0)}
    >
      {children}
    </AppShell>
  );
}
