import Link from "next/link";
import type { Account, Recipient } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function DashboardPage() {
  const [account, recipients] = await Promise.all([
    serverApiFetch<Account>("/accounts/me"),
    serverApiFetch<Paginated<Recipient>>("/recipients?perPage=1"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Welcome, {account?.name}</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/recipients"
          className="rounded-lg border border-black/10 p-6 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20"
        >
          <p className="text-sm text-foreground/60">Total recipients</p>
          <p className="text-3xl font-semibold">{recipients?.total ?? 0}</p>
        </Link>
      </div>

      <p className="text-foreground/70">
        Occasion tracking and card ordering wire up here in Phase 2 and 3.
      </p>
    </div>
  );
}
