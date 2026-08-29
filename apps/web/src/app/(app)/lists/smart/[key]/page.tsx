import { notFound } from "next/navigation";
import type { RecipientListSummary, SegmentSummary, SegmentsOverview } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { SmartListClient } from "./smart-list-client";

/**
 * One smart list. The key is either a saved list's id or a suggested preset's
 * slug, matching what `/send?segment=` accepts, so a suggestion can be opened
 * and sent to without being saved first. A preset is read-only: it has no row
 * to rename or delete, so the page offers to save a copy instead.
 * See docs/adr/0177.
 */
export default async function SmartListPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  const [overview, lists] = await Promise.all([
    serverApiFetch<SegmentsOverview>("/segments").catch(() => null),
    serverApiFetch<RecipientListSummary[]>("/recipient-lists").catch(() => null),
  ]);
  if (!overview) notFound();

  const found: SegmentSummary | undefined =
    overview.saved.find((s) => s.key === key) ?? overview.suggested.find((s) => s.key === key);
  if (!found) notFound();

  return <SmartListClient segment={found} lists={lists ?? []} />;
}
