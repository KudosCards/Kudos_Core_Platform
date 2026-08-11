import type { PlanEntitlement, SavedDesign } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ApprovalsClient, type OccasionWithRecipient } from "./approvals-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function ApprovalsPage() {
  const [occasions, scheduledSends, savedDesigns, entitlements] = await Promise.all([
    serverApiFetch<Paginated<OccasionWithRecipient>>(
      "/occasions?status=pending_approval&perPage=50",
    ),
    // Cards already approved for auto-send but not yet posted — shown so they're
    // visible after approval and cancellable until the auto-send cron posts them.
    serverApiFetch<Paginated<OccasionWithRecipient>>(
      "/occasions?status=approved&dispatchOption=auto_send&perPage=50",
    ),
    serverApiFetch<SavedDesign[]>("/saved-designs"),
    serverApiFetch<PlanEntitlement>("/accounts/me/entitlements"),
  ]);

  return (
    <ApprovalsClient
      initialOccasions={occasions?.items ?? []}
      initialScheduledSends={scheduledSends?.items ?? []}
      savedDesigns={savedDesigns ?? []}
      autoSendEnabled={entitlements?.autoSendEnabled ?? false}
    />
  );
}
