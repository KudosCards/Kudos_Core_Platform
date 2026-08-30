"use client";

import { CalendarCheck, Printer, Truck } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AdminOrderLine,
  BatchOrderStatus,
  FulfillmentJobStatus,
  OccasionRedateSummary,
} from "@kudos/shared-types";
import { OPEN_FULFILLMENT_STATUSES, royalMailTrackingUrl } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { OCCASION_TYPE_LABELS } from "@/lib/occasions";
import { promptTrackingReference } from "@/lib/tracking-prompt";
import { PrintRunOverlay, type PrintRunCard } from "@/app/(ops)/fulfillment/print-run-overlay";

const JOB_STATUS_LABELS: Record<FulfillmentJobStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  printed: "Printed",
  posted: "Posted",
  delivered: "Delivered",
  returned_to_sender: "Returned",
  failed: "Failed",
};

const JOB_STATUS_CLASSES: Record<FulfillmentJobStatus, string> = {
  pending: "bg-foreground/[0.07] text-muted",
  in_progress: "bg-sky-100 text-sky-800",
  printed: "bg-indigo-100 text-indigo-800",
  posted: "bg-emerald-100 text-emerald-800",
  delivered: "bg-emerald-100 text-emerald-800",
  returned_to_sender: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

const REDATE_OUTCOME_LABELS: Record<OccasionRedateSummary["cards"][number]["outcome"], string> = {
  redated: "Re-dated",
  "already-repaired": "Already done",
  "no-occasion": "No occasion — left alone",
};

const REDATE_OUTCOME_CLASSES: Record<OccasionRedateSummary["cards"][number]["outcome"], string> = {
  redated: "bg-emerald-100 text-emerald-800",
  "already-repaired": "bg-foreground/[0.07] text-muted",
  "no-occasion": "bg-amber-100 text-amber-800",
};

const POSTAGE_LABELS: Record<string, string> = {
  first_class: "1st class",
  second_class: "2nd class",
};

/** The single forward step each status offers, mirroring the dispatch queue. */
const NEXT_STEP: Partial<
  Record<FulfillmentJobStatus, { to: FulfillmentJobStatus; label: string }>
> = {
  pending: { to: "printed", label: "Mark printed" },
  in_progress: { to: "printed", label: "Mark printed" },
  printed: { to: "posted", label: "Mark posted" },
  posted: { to: "delivered", label: "Mark delivered" },
};

/** The active job statuses whose posting deadline still matters. */
/** Shared with the API and the fulfilment queue, so the three cannot drift on
 * what "still to post" means — which they had. See ADR 0108 §5. */
const OPEN_STATUSES: readonly FulfillmentJobStatus[] = OPEN_FULFILLMENT_STATUSES;

function fmtDay(value: string | Date | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function isOverdue(dueDate: string | Date | null, status: FulfillmentJobStatus | null): boolean {
  if (!dueDate || !status || !OPEN_STATUSES.includes(status)) return false;
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

/** A compact fulfilment trail for one card — the milestones reached, each with
 * its day. Reads the line's own `*At` timestamps (the audited state-machine
 * times), so no extra fetch. Mirrors the dispatch queue's trail. See ADR 0123. */
function StatusTrail({ line }: { line: AdminOrderLine }) {
  const steps: { label: string; at: string | Date | null }[] = [
    { label: "Printed", at: line.printedAt },
    { label: "Posted", at: line.postedAt },
    { label: "Delivered", at: line.deliveredAt },
  ];
  const reached = steps.filter((s) => s.at);
  if (reached.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-muted">
      {reached.map((s, i) => (
        <span key={s.label}>
          {i > 0 && " · "}
          <span className="font-medium text-foreground/70">{s.label}</span> {fmtDay(s.at)}
        </span>
      ))}
    </p>
  );
}

/**
 * The per-order fulfilment cockpit: every card's state with the same
 * view/print/dispatch/deliver actions the dispatch queue offers, plus
 * order-level batch actions (print sheet, dispatch all, mark all posted/
 * delivered, check deliveries) — so an operator can drive a whole order end to
 * end from one screen without hopping to the cross-account queue. Every action
 * hits the existing PlatformAdmin-gated fulfilment endpoints; after each, the
 * server component refetches so the header progress and rows stay in step.
 * See ADR 0123.
 */
export function OrderCockpit({
  orderId,
  orderStatus,
  lines,
  shippingEnabled,
  clickAndDropEnabled,
  isSuperAdmin,
}: {
  orderId: string;
  orderStatus: BatchOrderStatus;
  lines: AdminOrderLine[];
  shippingEnabled: boolean;
  clickAndDropEnabled: boolean;
  /** Whether the viewer may run the super-admin-only occasion re-date. */
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printCards, setPrintCards] = useState<PrintRunCard[] | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [redate, setRedate] = useState<OccasionRedateSummary | null>(null);

  const jobIds = lines.flatMap((l) => (l.jobId ? [l.jobId] : []));
  const printedIds = lines.flatMap((l) => (l.jobId && l.jobStatus === "printed" ? [l.jobId] : []));
  const postedIds = lines.flatMap((l) => (l.jobId && l.jobStatus === "posted" ? [l.jobId] : []));
  const busy = busyJob !== null || bulkBusy !== null;

  // Mirror the server's guard so the button isn't offered where it would only
  // 409: a paid, not-yet-started order, every card still pending. A printed card
  // has physically happened and can't be re-dated.
  const canRedate =
    isSuperAdmin &&
    lines.length > 0 &&
    (orderStatus === "paid" || orderStatus === "fulfilling") &&
    lines.every((l) => l.jobStatus === null || l.jobStatus === "pending");

  function reportError(e: unknown) {
    setError(e instanceof ApiError ? e.message : "Something went wrong — try again.");
  }

  /** Open the print-run overlay (view + print) for a set of cards. */
  async function openView(ids: string[]) {
    if (ids.length === 0) return;
    setPrintLoading(true);
    setError(null);
    try {
      const cards = await clientApiFetch<PrintRunCard[]>("/fulfillment/print-run", {
        method: "POST",
        body: JSON.stringify({ jobIds: ids }),
      });
      setPrintCards(cards);
    } catch (e) {
      reportError(e);
    } finally {
      setPrintLoading(false);
    }
  }

  async function advance(line: AdminOrderLine) {
    const step = line.jobStatus ? NEXT_STEP[line.jobStatus] : undefined;
    if (!step || !line.jobId) return;
    setBusyJob(line.jobId);
    setError(null);
    try {
      const body: Record<string, unknown> = { toStatus: step.to };
      if (step.to === "posted") {
        const tracking = promptTrackingReference();
        // Backed out — Cancel or Escape. Posting is one-way, so a cancelled
        // prompt must cancel the transition, not fall through to it.
        if (!tracking) return;
        Object.assign(body, tracking);
      }
      await clientApiFetch(`/fulfillment/jobs/${line.jobId}/transition`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusyJob(null);
    }
  }

  async function dispatchRoyalMail(line: AdminOrderLine) {
    if (!line.jobId) return;
    setBusyJob(line.jobId);
    setError(null);
    try {
      await clientApiFetch(`/fulfillment/jobs/${line.jobId}/dispatch`, { method: "POST" });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusyJob(null);
    }
  }

  async function retryClickAndDrop(line: AdminOrderLine) {
    if (!line.jobId) return;
    setBusyJob(line.jobId);
    setError(null);
    try {
      await clientApiFetch(`/fulfillment/jobs/${line.jobId}/click-and-drop`, { method: "POST" });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusyJob(null);
    }
  }

  /** Run an order-level batch action, then refetch so progress + rows update. */
  async function runBulk(key: string, request: () => Promise<unknown>) {
    setBulkBusy(key);
    setError(null);
    try {
      await request();
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBulkBusy(null);
    }
  }

  /**
   * Re-date every card in this order onto its own recipient's occasion.
   *
   * The repair for an order sent with `useOccasionDates` off, where every card
   * was dated the send day instead of each recipient's birthday. Confirmed
   * first because it rewrites dispatch dates across the whole order, and the
   * per-card report is kept on screen afterwards — "we changed 76 things" is
   * not something anyone can check.
   */
  async function runRedate() {
    if (
      !window.confirm(
        `Re-date all ${lines.length} cards in this order onto each recipient's own occasion date?\n\n` +
          "Cards with no dated occasion are left exactly as they are. This can be run again safely.",
      )
    ) {
      return;
    }
    setBulkBusy("redate");
    setError(null);
    setRedate(null);
    try {
      setRedate(
        await clientApiFetch<OccasionRedateSummary>(
          `/admin/orders/${orderId}/redate-to-occasions`,
          {
            method: "POST",
          },
        ),
      );
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBulkBusy(null);
    }
  }

  const bulkTransition = (ids: string[], toStatus: FulfillmentJobStatus) =>
    clientApiFetch("/fulfillment/jobs/bulk-transition", {
      method: "POST",
      body: JSON.stringify({ jobIds: ids, toStatus }),
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
          Cards ({lines.length.toLocaleString("en-GB")})
        </h2>
        {/* Order-level batch actions — each appears only when it has cards to act on. */}
        <div className="flex flex-wrap items-center gap-2">
          {canRedate && (
            <button
              type="button"
              disabled={busy}
              title="Move every card onto its own recipient's occasion date, instead of the day the order was sent"
              onClick={() => void runRedate()}
              className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-40"
            >
              {bulkBusy === "redate" ? (
                "…"
              ) : (
                <>
                  <CalendarCheck
                    className="mr-1 inline h-3.5 w-3.5 align-text-bottom"
                    aria-hidden
                  />{" "}
                  Re-date to birthdays
                </>
              )}
            </button>
          )}
          {jobIds.length > 0 && (
            <button
              type="button"
              disabled={busy || printLoading}
              onClick={() => void openView(jobIds)}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/5 disabled:opacity-40"
            >
              {printLoading ? (
                "…"
              ) : (
                <>
                  <Printer className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />{" "}
                  Print sheet ({jobIds.length})
                </>
              )}
            </button>
          )}
          {shippingEnabled && printedIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runBulk("dispatch", () =>
                  clientApiFetch("/fulfillment/jobs/dispatch", {
                    method: "POST",
                    body: JSON.stringify({ jobIds: printedIds }),
                  }),
                )
              }
              className="rounded-full border border-accent bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {bulkBusy === "dispatch" ? (
                "…"
              ) : (
                <>
                  <Truck className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />{" "}
                  Dispatch all ({printedIds.length})
                </>
              )}
            </button>
          )}
          {printedIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runBulk("posted", () => bulkTransition(printedIds, "posted"))}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/5 disabled:opacity-40"
            >
              {bulkBusy === "posted" ? "…" : `Mark all posted (${printedIds.length})`}
            </button>
          )}
          {postedIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runBulk("delivered", () => bulkTransition(postedIds, "delivered"))
              }
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/5 disabled:opacity-40"
            >
              {bulkBusy === "delivered" ? "…" : `Mark all delivered (${postedIds.length})`}
            </button>
          )}
          {shippingEnabled && postedIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              title="Ask Royal Mail tracking to update any posted cards now"
              onClick={() =>
                void runBulk("poll", () =>
                  clientApiFetch("/fulfillment/poll-deliveries", { method: "POST" }),
                )
              }
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/5 disabled:opacity-40"
            >
              {bulkBusy === "poll" ? "…" : "Check deliveries"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* The re-date report, card by card. Kept on screen until dismissed —
          it's the only record of what the repair actually did, and the
          "left alone" rows are the ones that need a human. */}
      {redate && (
        <div className="rounded-xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{redate.redated}</span> re-dated ·{" "}
              <span className="font-semibold tabular-nums">{redate.unchanged}</span> left alone
            </p>
            <button
              type="button"
              onClick={() => setRedate(null)}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-foreground/5"
            >
              Dismiss
            </button>
          </div>
          {redate.redated === 0 && (
            <p className="border-b border-border bg-amber-50 px-4 py-3 text-xs text-amber-900">
              Nothing moved. Every card here either has no dated occasion to move to — the recipient
              has no birthday on file, or it’s a genuine one-off campaign card — or was already
              re-dated by an earlier run.
            </p>
          )}
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
                  <th className="px-4 py-2 font-medium">Recipient</th>
                  <th className="px-4 py-2 font-medium">Was</th>
                  <th className="px-4 py-2 font-medium">Now</th>
                  <th className="px-4 py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {redate.cards.map((card, i) => (
                  <tr key={`${card.recipientName}-${i}`}>
                    <td className="px-4 py-2 font-medium">{card.recipientName}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-muted">{fmtDay(card.from)}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {card.outcome === "redated" ? (
                        <span className="font-medium">{fmtDay(card.to)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${REDATE_OUTCOME_CLASSES[card.outcome]}`}
                      >
                        {REDATE_OUTCOME_LABELS[card.outcome]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-5 py-3 font-medium">Recipient</th>
              <th className="px-5 py-3 font-medium">Occasion</th>
              <th className="px-5 py-3 font-medium">Design</th>
              <th className="px-5 py-3 font-medium">Postage</th>
              <th className="px-5 py-3 font-medium">Due</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => {
              const overdue = isOverdue(line.dueDate, line.jobStatus);
              const step = line.jobStatus ? NEXT_STEP[line.jobStatus] : undefined;
              const rowBusy = busyJob === line.jobId;
              return (
                <tr key={line.orderRecipientId} className="align-top hover:bg-foreground/[0.02]">
                  <td className="px-5 py-3 font-medium">{line.recipientName}</td>
                  <td className="px-5 py-3 text-muted">
                    {line.occasionType
                      ? (OCCASION_TYPE_LABELS[line.occasionType] ?? line.occasionType)
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-muted">{line.designName}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted">
                    {POSTAGE_LABELS[line.postageClass] ?? line.postageClass}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    {line.dueDate ? (
                      <span className={overdue ? "font-medium text-red-600" : "text-muted"}>
                        {fmtDay(line.dueDate)}
                        {overdue && " · overdue"}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {line.jobStatus ? (
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${JOB_STATUS_CLASSES[line.jobStatus]}`}
                      >
                        {JOB_STATUS_LABELS[line.jobStatus]}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">Not queued</span>
                    )}
                    <StatusTrail line={line} />
                    {(line.trackingReference || line.labelUrl) && (
                      <p className="mt-1 text-xs text-muted">
                        {line.trackingReference && (
                          <a
                            href={royalMailTrackingUrl(line.trackingReference)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            Track {line.trackingReference}
                          </a>
                        )}
                        {line.labelUrl && (
                          <>
                            {line.trackingReference && " · "}
                            <a
                              href={line.labelUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                            >
                              Print label
                            </a>
                          </>
                        )}
                      </p>
                    )}
                    {clickAndDropEnabled && line.clickAndDropError && (
                      <p className="mt-1 text-xs">
                        <span title={line.clickAndDropError} className="text-amber-700">
                          ⚠ Click & Drop import failed
                        </span>{" "}
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={() => void retryClickAndDrop(line)}
                          className="text-accent hover:underline disabled:opacity-40"
                        >
                          Retry
                        </button>
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {line.jobId && (
                        <button
                          type="button"
                          disabled={busy || printLoading}
                          onClick={() => void openView([line.jobId!])}
                          className="rounded-full border border-border px-3 py-1 text-xs hover:bg-foreground/5 disabled:opacity-40"
                        >
                          View
                        </button>
                      )}
                      {shippingEnabled && line.jobStatus === "printed" && (
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={() => void dispatchRoyalMail(line)}
                          title="Create a Royal Mail shipment, buy postage, get tracking"
                          className="rounded-full border border-accent bg-accent-soft px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
                        >
                          {rowBusy ? (
                            "…"
                          ) : (
                            <>
                              <Truck
                                className="mr-1 inline h-3.5 w-3.5 align-text-bottom"
                                aria-hidden
                              />{" "}
                              Dispatch
                            </>
                          )}
                        </button>
                      )}
                      {step && (
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={() => void advance(line)}
                          className="rounded-full border border-border px-3 py-1 text-xs hover:bg-foreground/5 disabled:opacity-40"
                        >
                          {rowBusy ? "…" : step.label}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {printCards && <PrintRunOverlay cards={printCards} onClose={() => setPrintCards(null)} />}
    </section>
  );
}
