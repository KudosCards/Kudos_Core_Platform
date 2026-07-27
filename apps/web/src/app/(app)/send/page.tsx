import type { Recipient, RecipientListSummary, SavedDesign } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { BulkSendClient } from "./bulk-send-client";
import type { Paginated } from "./recipient-picker";

/**
 * Bulk send: the start-here composer for posting one design to a group of
 * contacts in a single order. Contacts can be chosen right here, and any that
 * arrive pre-selected from the Recipients page (`?recipients=id,id`) — or a
 * design being round-tripped back from the editor (`?design=`) — seed the
 * initial state. See docs/adr/0027-bulk-send-to-contacts.md.
 */
const PICKER_PER_PAGE = 20;

export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<{ recipients?: string; design?: string }>;
}) {
  const { recipients: recipientsParam, design: designParam } = await searchParams;
  const preIds = (recipientsParam ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  // Designs + lists + the first page of contacts for the picker, plus any
  // pre-selected contacts (fetched individually so they show even if they're
  // not on the first page). serverApiFetch returns null on error, so a dropped
  // id simply isn't pre-selected.
  const [designs, lists, recipientsPage, ...preResults] = await Promise.all([
    serverApiFetch<SavedDesign[]>("/saved-designs"),
    serverApiFetch<RecipientListSummary[]>("/recipient-lists"),
    serverApiFetch<Paginated<Recipient>>(
      `/recipients?page=1&perPage=${PICKER_PER_PAGE}&status=active`,
    ),
    ...preIds.map((id) => serverApiFetch<Recipient>(`/recipients/${id}`)),
  ]);
  const initialSelected = preResults.filter((r): r is Recipient => r !== null);

  const emptyPage: Paginated<Recipient> = {
    items: [],
    total: 0,
    page: 1,
    perPage: PICKER_PER_PAGE,
  };

  return (
    <BulkSendClient
      initialSelected={initialSelected}
      initialRecipientsPage={recipientsPage ?? emptyPage}
      designs={designs ?? []}
      lists={lists ?? []}
      initialDesignId={designParam ?? ""}
    />
  );
}
