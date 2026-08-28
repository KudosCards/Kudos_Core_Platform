import type { CardSize, DueFilter, FulfillmentCounts } from "@kudos/shared-types";
import { DEFAULT_CARD_SIZE, DUE_FILTERS } from "@kudos/shared-types";
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

const VALID_STATUSES: FulfillmentStatus[] = [
  "pending",
  "in_progress",
  "printed",
  "posted",
  "delivered",
  "failed",
];

export default async function FulfillmentPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; due?: string; dueOn?: string }>;
}) {
  const { status: statusParam, due: dueParam, dueOn: dueOnParam } = await searchParams;
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

  // The dispatch-calendar drill-in: one exact deadline day. When set, it takes
  // precedence over the `due` bucket and (unless a status tab is chosen) shows
  // every still-open card for that day. See ADR 0110.
  const jobsQuery = new URLSearchParams({ perPage: "100" });
  if (dueOn) {
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

  const [result, counts, printSize] = await Promise.all([
    serverApiFetch<Paginated<FulfillmentJob>>(`/fulfillment/jobs?${jobsQuery.toString()}`),
    serverApiFetch<FulfillmentCounts>("/fulfillment/counts"),
    // The super-admin default print size the print overlay opens on. Both this
    // page and the setting live behind PlatformAdminGuard (the whole ops area),
    // so reading the admin setting here is in-scope. See ADR 0138.
    serverApiFetch<{ size: CardSize }>("/admin/print/card-size"),
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
      counts={counts ?? emptyCounts}
      dueOn={dueOn}
      defaultPrintSize={printSize?.size ?? DEFAULT_CARD_SIZE}
    />
  );
}
