import type { SegmentsOverview } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { SegmentsClient } from "./segments-client";

/**
 * Segments (smart lists): suggested presets + the account's saved segments, each
 * resolved live to a count + preview. See docs/adr/0105-segments-smart-lists.md.
 */
export default async function SegmentsPage() {
  const overview =
    (await serverApiFetch<SegmentsOverview>("/segments").catch(() => null)) ??
    ({ suggested: [], saved: [] } satisfies SegmentsOverview);

  return <SegmentsClient initial={overview} />;
}
