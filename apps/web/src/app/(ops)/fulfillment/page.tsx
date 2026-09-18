import type {
  CardSize,
  DueFilter,
  FulfillmentCounts,
  HeldFilter,
  PrintProfile,
} from "@kudos/shared-types";
import {
  DEFAULT_CARD_SIZE,
  DEFAULT_PRINT_PROFILE,
  DUE_FILTERS,
  FULFILLMENT_STATUSES,
  HELD_FILTERS,
} from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import {
  FulfillmentClient,
  type FulfillmentJob,
  type FulfillmentStatus,
} from "./fulfillment-client";

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

/** Every status the queue offers a tab for — the same list the client renders
 * from, so a tab can never point at a status this page then refuses. It used to
 * be written out here as well, and the two disagreed: `returned_to_sender` had a
 * tab with a live count and no way through. See ADR 0202. */
const VALID_STATUSES: readonly FulfillmentStatus[] = FULFILLMENT_STATUSES;

export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; due?: string; dueOn?: string; held?: string }>;
}) {
  const {
    status: statusParam,
    due: dueParam,
    dueOn: dueOnParam,
    held: heldParam,
  } = await searchParams;
  // Whether a status tab was explicitly chosen (vs the page's own default). A
  // calendar drill-in (dueOn, no status) deliberately shows all open cards for
  // the day, so we only pin a status when the operator picked one.
  const explicitStatus: FulfillmentStatus | null = VALID_STATUSES.includes(
    statusParam as FulfillmentStatus,
  )
    ? (statusParam as FulfillmentStatus)
    : null;
  // null = no deadline question asked, which is the queue's landing view. Kept
  // distinct from an explicit `due=all`, because asking the deadline question at
  // all widens the queue from pending to every still-open card.
  const due: DueFilter | null = DUE_FILTERS.includes(dueParam as DueFilter)
    ? (dueParam as DueFilter)
    : null;
  const dueOn =
    typeof dueOnParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueOnParam) ? dueOnParam : null;
  // The cards the server refuses to print or post. Its own question, not a
  // deadline one, so it stands apart from `due`.
  const held: HeldFilter | null = HELD_FILTERS.includes(heldParam as HeldFilter)
    ? (heldParam as HeldFilter)
    : null;

  // The dispatch-calendar drill-in: one exact deadline day. When set, it takes
  // precedence over the `due` bucket and (unless a status tab is chosen) shows
  // every still-open card for that day. See ADR 0110.
  const jobsQuery = new URLSearchParams({ perPage: "100" });
  if (held) {
    // A held card can sit at any open status, so asking for them releases the
    // status pin exactly as a deadline question does.
    jobsQuery.set("held", held);
    if (explicitStatus) jobsQuery.set("status", explicitStatus);
  } else if (dueOn) {
    jobsQuery.set("dueOn", dueOn);
    if (explicitStatus) jobsQuery.set("status", explicitStatus);
  } else if (due) {
    // A deadline filter spans every still-open card unless a status tab narrows
    // it — the same rule as the calendar drill-in above, so the queue agrees
    // with the dispatch calendar and the send-by-5 banner. See ADR 0108 §5.
    jobsQuery.set("due", due);
    if (explicitStatus) jobsQuery.set("status", explicitStatus);
  } else {
    // The landing view: the actionable pending backlog, soonest deadline first
    // (API default sort), so overdue cards surface at the top. See ADR 0108.
    jobsQuery.set("status", explicitStatus ?? "pending");
  }

  const [result, counts, printSize, printProfile] = await Promise.all([
    serverApiFetch<Paginated<FulfillmentJob>>(`/fulfillment/jobs?${jobsQuery.toString()}`),
    serverApiFetch<FulfillmentCounts>("/fulfillment/counts"),
    // The super-admin default print size the print overlay opens on. Both this
    // page and the setting live behind PlatformAdminGuard (the whole ops area),
    // so reading the admin setting here is in-scope. See ADR 0138.
    serverApiFetch<{ size: CardSize }>("/admin/print/card-size"),
    // And the profile, because it decides whether browser print can produce
    // anything foldable at all. Same guard as the size above. See ADR 0249.
    serverApiFetch<{ profile: PrintProfile }>("/admin/print/profile"),
  ]);

  const emptyCounts: FulfillmentCounts = {
    status: {
      pending: 0,
      in_progress: 0,
      printed: 0,
      posted: 0,
      delivered: 0,
      returned_to_sender: 0,
      failed: 0,
    },
    due: { overdue: 0, today: 0, dueSoon: 0, upcoming: 0, noDate: 0 },
    clickAndDropErrors: 0,
    held: 0,
  };

  // Under a deadline question with no chosen status, no tab is "active" — the
  // queue shows every open card matching it. Otherwise it defaults to pending.
  const clientStatus: FulfillmentStatus | null =
    dueOn || due ? explicitStatus : (explicitStatus ?? "pending");

  return (
    <FulfillmentClient
      initialJobs={result?.items ?? []}
      status={clientStatus}
      due={due}
      held={held}
      counts={counts ?? emptyCounts}
      dueOn={dueOn}
      defaultPrintSize={printSize?.size ?? DEFAULT_CARD_SIZE}
      printLayout={printProfile?.profile?.layout ?? DEFAULT_PRINT_PROFILE.layout}
    />
  );
}
