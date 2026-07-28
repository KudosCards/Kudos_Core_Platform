import { Suspense } from "react";
import Link from "next/link";
import type { SupportTicketSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { Skeleton } from "@/components/skeleton";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUS_CLASSES,
  SUPPORT_STATUS_LABELS,
  formatSupportDate,
  ticketRef,
} from "@/lib/support";
import { NewTicketForm } from "./new-ticket-form";

/**
 * The subscriber's support area: raise a ticket and follow the two-way thread
 * with the Kudos support team. The header + form render immediately; the ticket
 * list streams in behind a Suspense boundary. See docs/adr/0066-support-ticketing.md.
 */
export default function SupportPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Support</h1>
        <p className="text-muted">
          Need a hand? Raise a ticket and our support team will reply here — you&apos;ll get an email
          and a notification when they do.
        </p>
      </div>

      <NewTicketForm />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your tickets</h2>
        <Suspense fallback={<TicketListSkeleton />}>
          <TicketList />
        </Suspense>
      </div>
    </div>
  );
}

async function TicketList() {
  const tickets = (await serverApiFetch<SupportTicketSummary[]>("/support")) ?? [];

  if (tickets.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        You haven&apos;t raised any tickets yet. Use the form above to get in touch.
      </div>
    );
  }

  return (
    <div className="card divide-y divide-border overflow-hidden">
      {tickets.map((t) => (
        <Link
          key={t.id}
          href={`/support/${t.id}`}
          className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-foreground/[0.03]"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{t.subject}</span>
            </div>
            <span className="text-xs text-muted">
              {ticketRef(t.ticketNumber)} · {SUPPORT_CATEGORY_LABELS[t.category]} ·{" "}
              {formatSupportDate(t.lastMessageAt)}
            </span>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${SUPPORT_STATUS_CLASSES[t.status]}`}
          >
            {SUPPORT_STATUS_LABELS[t.status]}
          </span>
        </Link>
      ))}
    </div>
  );
}

function TicketListSkeleton() {
  return (
    <div className="card divide-y divide-border overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}
