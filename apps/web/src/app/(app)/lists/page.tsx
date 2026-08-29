import type { RecipientListSummary, SegmentsOverview } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ListsClient } from "./lists-client";

/**
 * Lists: every grouping of contacts in one place, of either kind — the ones you
 * pick by hand, and the smart ones a rule keeps current. Replaces the old
 * Segments page, which showed only half of them. See docs/adr/0177.
 */
export default async function ListsPage() {
  const [picked, smart] = await Promise.all([
    serverApiFetch<RecipientListSummary[]>("/recipient-lists").catch(() => null),
    serverApiFetch<SegmentsOverview>("/segments").catch(() => null),
  ]);

  return (
    <ListsClient
      initialPicked={picked ?? []}
      initialSmart={smart ?? { suggested: [], saved: [] }}
    />
  );
}
