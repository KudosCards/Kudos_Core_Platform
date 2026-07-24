import Link from "next/link";
import type { RtsQueueItem } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

const REASON_LABELS: Record<string, string> = {
  moved: "Moved",
  incomplete_address: "Incomplete address",
  incorrect_address: "Incorrect address",
  undeliverable: "Undeliverable",
  other: "Other",
};

const OCCASION_LABELS: Record<string, string> = {
  birthday: "Birthday",
  achievement: "Achievement",
  leaver: "Leaver",
  staff_recognition: "Staff recognition",
  seasonal: "Seasonal",
  bespoke_campaign: "Campaign",
};

const TABS: { value: string; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "awaiting_address", label: "Awaiting address" },
  { value: "awaiting_resend", label: "Awaiting resend" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
];

function stageLabel(item: RtsQueueItem): string {
  if (item.awaitingAddress) return "Awaiting address";
  if (item.awaitingResend) return "Awaiting resend";
  if (item.archived) return "Archived";
  return "Resolved";
}

export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = status && TABS.some((t) => t.value === status) ? status : "open";
  const result = await serverApiFetch<Paginated<RtsQueueItem>>(
    `/admin/returns?status=${active}&perPage=100`,
  );
  const items = result?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Returned to sender</h1>
        <p className="text-sm text-foreground/60">
          Cards Royal Mail sent back. Customers recover them from their own contact records; this
          queue tracks where each one is.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/returns?status=${tab.value}`}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              active === tab.value
                ? "border-black/40 bg-black/5 font-medium dark:border-white/40 dark:bg-white/10"
                : "border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-black/10 p-8 text-center text-sm text-foreground/60 dark:border-white/10">
          Nothing here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-foreground/50 dark:border-white/10">
              <tr>
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Days since return</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Free recovery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 dark:divide-white/5">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">{item.businessName}</td>
                  <td className="px-4 py-3">{item.recipientName}</td>
                  <td className="px-4 py-3">
                    {item.occasionType ? OCCASION_LABELS[item.occasionType] ?? item.occasionType : "—"}
                  </td>
                  <td className="px-4 py-3">{REASON_LABELS[item.reason] ?? item.reason}</td>
                  <td className="px-4 py-3">{item.daysSinceReturn}</td>
                  <td className="px-4 py-3">{stageLabel(item)}</td>
                  <td className="px-4 py-3">{item.freeRecoveryUsed ? "Used" : "Available"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
