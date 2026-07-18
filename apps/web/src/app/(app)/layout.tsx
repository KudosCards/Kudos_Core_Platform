import { redirect } from "next/navigation";
import type { Account, DashboardSummary } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { serverApiFetch } from "@/lib/api.server";
import { formatGbp } from "@/lib/orders";
import { AppShell } from "./app-shell";

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
    <AppShell
      accountName={account.name}
      planLabel={planLabel}
      pendingApprovals={summary?.pendingApprovals ?? 0}
      walletLabel={formatGbp(summary?.walletBalanceMinor ?? 0)}
    >
      {children}
    </AppShell>
  );
}
