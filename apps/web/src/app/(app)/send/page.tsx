import type {
  Recipient,
  RecipientListSummary,
  SavedDesign,
  SegmentMembers,
} from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { BulkSendClient, type SeededSegment } from "./bulk-send-client";
import type { Paginated } from "./recipient-picker";

/**
 * Bulk send: the start-here composer for posting one design to a group of
 * contacts in a single order. Contacts can be chosen right here, and any that
 * arrive pre-selected from the Recipients page (`?recipients=id,id`), from a
 * segment (`?segment=<preset-key-or-saved-id>` — its members seed the selection),
 * or a design being round-tripped back from the editor (`?design=`) — seed the
 * initial state. See docs/adr/0106-send-to-segment.md.
 */
const PICKER_PER_PAGE = 20;

export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<{ recipients?: string; design?: string; segment?: string }>;
}) {
  const {
    recipients: recipientsParam,
    design: designParam,
    segment: segmentParam,
  } = await searchParams;
  const preIds = (recipientsParam ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  // Designs + lists + the first page of contacts for the picker, any
  // pre-selected contacts (fetched individually so they show even if they're
  // not on the first page), and — when arriving from a segment — its resolved
  // members. serverApiFetch returns null on error, so a dropped id/segment
  // simply isn't pre-selected.
  const [designs, lists, recipientsPage, segmentMembers, ...preResults] = await Promise.all([
    serverApiFetch<SavedDesign[]>("/saved-designs"),
    serverApiFetch<RecipientListSummary[]>("/recipient-lists"),
    serverApiFetch<Paginated<Recipient>>(
      `/recipients?page=1&perPage=${PICKER_PER_PAGE}&status=active`,
    ),
    segmentParam
      ? serverApiFetch<SegmentMembers>(`/segments/members?segment=${encodeURIComponent(segmentParam)}`)
      : Promise.resolve(null),
    ...preIds.map((id) => serverApiFetch<Recipient>(`/recipients/${id}`)),
  ]);

  // Segment members + any individually pre-selected ids, de-duplicated by id.
  const byId = new Map<string, Recipient>();
  for (const member of segmentMembers?.members ?? []) byId.set(member.id, member);
  for (const r of preResults) if (r) byId.set(r.id, r);
  const initialSelected = [...byId.values()];

  const seededSegment: SeededSegment | null = segmentMembers
    ? {
        name: segmentMembers.name,
        total: segmentMembers.total,
        capped: segmentMembers.capped,
        reconciliations: segmentMembers.reconciliations,
      }
    : null;

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
      seededSegment={seededSegment}
    />
  );
}
