import { notFound } from "next/navigation";
import Link from "next/link";
import type { SupportTicketOpsDetail } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { OpsSupportThreadClient } from "./ops-support-thread-client";

/**
 * The ops view of one ticket: the full thread (including internal notes), a
 * reply box with an internal-note toggle, and status / priority / assignment
 * controls. See docs/adr/0066-support-ticketing.md.
 */
export default async function AdminSupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticket = await serverApiFetch<SupportTicketOpsDetail>(`/admin/support/${id}`);
  if (!ticket) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/support" className="text-sm text-accent hover:underline">
        ← Back to support queue
      </Link>
      <OpsSupportThreadClient ticket={ticket} />
    </div>
  );
}
