import type { SavedDesign } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ApprovalsClient, type OccasionWithRecipient } from "./approvals-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function ApprovalsPage() {
  const [occasions, savedDesigns] = await Promise.all([
    serverApiFetch<Paginated<OccasionWithRecipient>>(
      "/occasions?status=pending_approval&perPage=50",
    ),
    serverApiFetch<SavedDesign[]>("/saved-designs"),
  ]);

  return (
    <ApprovalsClient initialOccasions={occasions?.items ?? []} savedDesigns={savedDesigns ?? []} />
  );
}
