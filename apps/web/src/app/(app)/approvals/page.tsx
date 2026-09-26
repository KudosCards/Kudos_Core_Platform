import type { PlanEntitlement, SavedDesign, StandingOrder } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { ApprovalsClient, type OccasionWithRecipient } from "./approvals-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export default async function ApprovalsPage() {
  const [occasions, scheduledSends, awaitingOrder, savedDesigns, entitlements, standingOrder] =
    await Promise.all([
      serverApiFetch<Paginated<OccasionWithRecipient>>(
        // 100 is the API's ceiling (parsePerPage). Above that the queue says so
        // rather than quietly ending — see TruncationNotice.
        "/occasions?status=pending_approval&perPage=100",
      ),
      // Cards already approved for auto-send but not yet posted — shown so they're
      // visible after approval and cancellable until the auto-send cron posts them.
      serverApiFetch<Paginated<OccasionWithRecipient>>(
        "/occasions?status=approved&dispatchOption=auto_send&perPage=50",
      ),
      // Approved, but waiting for somebody to place and pay for an order. Nothing
      // sends these: the auto-send cron only acts on `auto_send`, and the nightly
      // sweep retires them as `missed` once the date passes. Before this section
      // existed they appeared on no screen at all — approved, so out of the queue
      // above; not automated, so out of the one below — while the calendar drew
      // them the same yellow as a card that was not ready at all. Seven cards on
      // one account were lost that way. See
      // docs/click-and-forget-capture-recon.md.
      serverApiFetch<Paginated<OccasionWithRecipient>>(
        "/occasions?status=approved&dispatchOption=asap&perPage=100",
      ),
      serverApiFetch<SavedDesign[]>("/saved-designs"),
      serverApiFetch<PlanEntitlement>("/accounts/me/entitlements"),
      // Whether click and forget is actually running — `active` is the API's own
      // "switched on and nothing blocking it", the same rule the approval cron
      // uses. The queue needs it because approving by hand on an account that has
      // asked not to be asked was silently opting each card out of the
      // automation. See ADR 0271.
      serverApiFetch<StandingOrder>("/standing-order"),
    ]);

  return (
    <ApprovalsClient
      initialOccasions={occasions?.items ?? []}
      totalPending={occasions?.total ?? 0}
      initialScheduledSends={scheduledSends?.items ?? []}
      awaitingOrder={awaitingOrder?.items ?? []}
      totalAwaitingOrder={awaitingOrder?.total ?? 0}
      // Resolved once, here, and passed down. Computing "today" inside a client
      // component makes the server and the browser disagree across midnight and
      // across timezones, which is a hydration error on a screen whose whole job
      // is to be trusted about dates.
      todayIso={new Date().toISOString().slice(0, 10)}
      savedDesigns={savedDesigns ?? []}
      autoSendEnabled={entitlements?.autoSendEnabled ?? false}
      clickAndForgetRunning={standingOrder?.active ?? false}
    />
  );
}
