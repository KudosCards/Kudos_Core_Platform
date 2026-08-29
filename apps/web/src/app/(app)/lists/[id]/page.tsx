import { notFound } from "next/navigation";
import type { Recipient, RecipientListSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import type { Paginated } from "../../recipients/recipients-client";
import { PickedListClient, MEMBERS_PER_PAGE } from "./picked-list-client";

/**
 * One hand-picked list: who's on it, and everything you can do with them.
 *
 * The members come from `GET /recipients?listId=` rather than from the list
 * route, so the page is paginated and can carry the same search and sort the
 * contacts table uses. The list route supplies only the name and the true
 * count. See docs/adr/0177.
 */
export default async function PickedListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [list, members] = await Promise.all([
    serverApiFetch<RecipientListSummary>(`/recipient-lists/${id}`).catch(() => null),
    serverApiFetch<Paginated<Recipient>>(
      `/recipients?listId=${encodeURIComponent(id)}&page=1&perPage=${MEMBERS_PER_PAGE}`,
    ).catch(() => null),
  ]);

  if (!list) notFound();

  return (
    <PickedListClient
      list={list}
      initialMembers={members ?? { items: [], total: 0, page: 1, perPage: MEMBERS_PER_PAGE }}
    />
  );
}
