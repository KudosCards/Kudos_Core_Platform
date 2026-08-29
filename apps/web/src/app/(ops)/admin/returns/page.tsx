import Link from "next/link";
import type { RtsQueueItem } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { TruncationNotice } from "@/components/truncation-notice";

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
      <TruncationNotice
        shown={items.length}
        total={result?.total ?? 0}
        unit="returned cards"
        hint="Work through these to see the rest."
      />
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
                ? "border-black/40 bg-black/5 font-medium"
                : "border-black/15 hover:bg-black/5"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-black/10 p-8 text-center text-sm text-foreground/60">
          Nothing here.
        </p>
      ) : (
        <>
          {/* Table on ≥sm; a stacked-card list replaces it on phones. */}
          <div className="hidden overflow-x-auto rounded-xl border border-black/10 sm:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-foreground/50">
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
              <tbody className="divide-y divide-black/5">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3">{item.businessName}</td>
                    <td className="px-4 py-3">{item.recipientName}</td>
                    <td className="px-4 py-3">
                      {item.occasionType
                        ? (OCCASION_LABELS[item.occasionType] ?? item.occasionType)
                        : "—"}
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

          <div className="flex flex-col gap-3 sm:hidden">
            {items.map((item) => (
              <div key={item.id} className="rounded-xl border border-black/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{item.recipientName}</p>
                    <p className="truncate text-xs text-foreground/60">{item.businessName}</p>
                  </div>
                  <span className="shrink-0 text-xs text-foreground/60">{stageLabel(item)}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-foreground/50">
                      Event
                    </dt>
                    <dd>
                      {item.occasionType
                        ? (OCCASION_LABELS[item.occasionType] ?? item.occasionType)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-foreground/50">
                      Reason
                    </dt>
                    <dd>{REASON_LABELS[item.reason] ?? item.reason}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-foreground/50">
                      Days since return
                    </dt>
                    <dd>{item.daysSinceReturn}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wide text-foreground/50">
                      Free recovery
                    </dt>
                    <dd>{item.freeRecoveryUsed ? "Used" : "Available"}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
