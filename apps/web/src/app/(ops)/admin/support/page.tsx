import Link from "next/link";
import type { SupportTicketOpsSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_CLASSES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_CLASSES,
  SUPPORT_STATUS_LABELS_OPS,
  formatSupportDate,
  ticketRef,
} from "@/lib/support";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

const TABS: { value: string; label: string }[] = [
  { value: "open", label: "Needs attention" },
  { value: "awaiting_customer", label: "Awaiting customer" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

/**
 * The ops support queue — every subscriber ticket across all accounts. Defaults
 * to "needs attention" (everything not yet closed), longest wait first. Rows
 * link into the thread where operators reply. See docs/adr/0066-support-ticketing.md.
 */
export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = status && TABS.some((t) => t.value === status) ? status : "open";
  const result = await serverApiFetch<Paginated<SupportTicketOpsSummary>>(
    `/admin/support?status=${active}&perPage=100`,
  );
  const items = result?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Support</h1>
        <p className="text-sm text-foreground/60">
          Tickets raised by subscribers. Open one to read the thread and reply — the customer is
          notified by email and in-app.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/support?status=${tab.value}`}
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
        <>
          {/* Table on ≥sm; a stacked-card list replaces it on phones. */}
          <div className="hidden overflow-x-auto rounded-xl border border-black/10 sm:block dark:border-white/10">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-foreground/50 dark:border-white/10">
                <tr>
                  <th className="px-4 py-3 font-medium">Ref</th>
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Last activity</th>
                  <th className="px-4 py-3 font-medium">Assignee</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {items.map((t) => (
                  <tr key={t.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                      <Link href={`/admin/support/${t.id}`} className="hover:underline">
                        {ticketRef(t.ticketNumber)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{t.businessName}</td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/support/${t.id}`} className="font-medium hover:underline">
                        {t.subject}
                      </Link>
                      {t.lastMessageFrom === "customer" && t.status !== "closed" && (
                        <span className="ml-2 inline-block size-2 rounded-full bg-accent align-middle" />
                      )}
                    </td>
                    <td className="px-4 py-3">{SUPPORT_CATEGORY_LABELS[t.category]}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SUPPORT_PRIORITY_CLASSES[t.priority]}`}
                      >
                        {SUPPORT_PRIORITY_LABELS[t.priority]}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-foreground/70">
                      {formatSupportDate(t.lastMessageAt)}
                    </td>
                    <td className="px-4 py-3 text-foreground/70">{t.assignee ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SUPPORT_STATUS_CLASSES[t.status]}`}
                      >
                        {SUPPORT_STATUS_LABELS_OPS[t.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 sm:hidden">
            {items.map((t) => (
              <Link
                key={t.id}
                href={`/admin/support/${t.id}`}
                className="block rounded-xl border border-black/10 p-4 hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.03]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t.subject}
                      {t.lastMessageFrom === "customer" && t.status !== "closed" && (
                        <span className="ml-2 inline-block size-2 rounded-full bg-accent align-middle" />
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-foreground/60">
                      <span className="font-mono">{ticketRef(t.ticketNumber)}</span> ·{" "}
                      {t.businessName}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${SUPPORT_STATUS_CLASSES[t.status]}`}
                  >
                    {SUPPORT_STATUS_LABELS_OPS[t.status]}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/70">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SUPPORT_PRIORITY_CLASSES[t.priority]}`}
                  >
                    {SUPPORT_PRIORITY_LABELS[t.priority]}
                  </span>
                  <span>{SUPPORT_CATEGORY_LABELS[t.category]}</span>
                  <span aria-hidden>·</span>
                  <span>{formatSupportDate(t.lastMessageAt)}</span>
                  <span aria-hidden>·</span>
                  <span>{t.assignee ?? "Unassigned"}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
