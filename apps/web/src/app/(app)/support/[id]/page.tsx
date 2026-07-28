import { notFound } from "next/navigation";
import Link from "next/link";
import type { SupportTicketDetail } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { SupportThreadClient } from "./support-thread-client";

/**
 * A subscriber's view of one ticket: the full thread, a reply box, and a
 * "mark resolved / close" action. Fetched server-side; the interactive thread
 * is a client component. See docs/adr/0066-support-ticketing.md.
 */
export default async function SupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticket = await serverApiFetch<SupportTicketDetail>(`/support/${id}`);
  if (!ticket) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/support" className="text-sm text-accent hover:underline">
        ← Back to support
      </Link>
      <SupportThreadClient ticket={ticket} />
    </div>
  );
}
