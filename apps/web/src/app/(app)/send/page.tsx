import type { Recipient, SavedDesign } from "@kudos/shared-types";
import Link from "next/link";
import { serverApiFetch } from "@/lib/api.server";
import { BulkSendClient } from "./bulk-send-client";

/**
 * Bulk send: post one saved design to a set of existing contacts in a single
 * order. Contacts arrive as a `?recipients=id,id` list (from the Recipients
 * page's multi-select). Each contact's name and address are pulled from their
 * stored record — nothing is re-keyed. See docs/adr/0027-bulk-send-to-contacts.md.
 */
export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<{ recipients?: string }>;
}) {
  const { recipients: recipientsParam } = await searchParams;
  const ids = (recipientsParam ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Bulk send</h1>
        <div className="card flex flex-col items-start gap-3 p-8 text-sm text-muted">
          <p>Send the same card to a whole group in one go.</p>
          <p>
            Head to your{" "}
            <Link href="/recipients" className="text-accent hover:underline">
              Recipients
            </Link>{" "}
            page, tick the contacts you want to send to, then choose{" "}
            <span className="font-medium text-foreground">Send a card</span>.
          </p>
        </div>
      </div>
    );
  }

  // Fetch the selected contacts (in parallel) plus the account's saved designs.
  // serverApiFetch returns null on error, so any id that no longer resolves is
  // simply dropped from the list the sender sees.
  const [designs, ...recipientResults] = await Promise.all([
    serverApiFetch<SavedDesign[]>("/saved-designs"),
    ...ids.map((id) => serverApiFetch<Recipient>(`/recipients/${id}`)),
  ]);
  const recipients = recipientResults.filter((r): r is Recipient => r !== null);

  return (
    <BulkSendClient recipients={recipients} designs={designs ?? []} />
  );
}
