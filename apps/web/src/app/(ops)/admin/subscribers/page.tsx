import { serverApiFetch } from "@/lib/api.server";
import { formatGbp, formatOrderDate } from "@/lib/orders";

interface AdminSubscriberRow {
  id: string;
  name: string;
  type: string;
  plan: string;
  createdAt: string;
  orderCount: number;
  cardsSent: number;
  totalSpentMinor: number;
  hasActiveSubscription: boolean;
  hasStripeCustomer: boolean;
}

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function AdminSubscribersPage() {
  const result = await serverApiFetch<Paginated<AdminSubscriberRow>>(
    "/admin/subscribers?perPage=100",
  );
  const subscribers = result?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Subscribers</h1>
        <p className="text-sm text-foreground/60">
          Every account on the platform{result ? ` · ${result.total.toLocaleString("en-GB")} total` : ""}.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
        {subscribers.length === 0 ? (
          <p className="p-6 text-sm text-foreground/60">No accounts yet.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs tracking-wide text-foreground/50 uppercase dark:border-white/10">
                <th className="px-5 py-3 font-medium">Account</th>
                <th className="px-5 py-3 font-medium">Plan</th>
                <th className="px-5 py-3 font-medium">Joined</th>
                <th className="px-5 py-3 text-right font-medium">Orders</th>
                <th className="px-5 py-3 text-right font-medium">Cards</th>
                <th className="px-5 py-3 text-right font-medium">Spent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {subscribers.map((subscriber) => (
                <tr key={subscriber.id}>
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium">{subscriber.name}</span>
                      <span className="text-xs text-foreground/50 capitalize">{subscriber.type}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="capitalize">{subscriber.plan}</span>
                      {subscriber.hasActiveSubscription && (
                        <span className="rounded-full bg-[#e8f1ea] px-2 py-0.5 text-xs font-medium text-[#2f7d54]">
                          active
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-foreground/70">
                    {formatOrderDate(subscriber.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-foreground/70">
                    {subscriber.orderCount}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-foreground/70">
                    {subscriber.cardsSent}
                  </td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">
                    {formatGbp(subscriber.totalSpentMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
