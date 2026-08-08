"use client";

import { Printer, Truck } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminOrderLine, FulfillmentJobStatus } from "@kudos/shared-types";
import { royalMailTrackingUrl } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { OCCASION_TYPE_LABELS } from "@/lib/occasions";
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
  in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  printed: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
  posted: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  delivered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  returned_to_sender: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

const POSTAGE_LABELS: Record<string, string> = {
  first_class: "1st class",
  second_class: "2nd class",
};

/** The single forward step each status offers, mirroring the dispatch queue. */
const NEXT_STEP: Partial<Record<FulfillmentJobStatus, { to: FulfillmentJobStatus; label: string }>> =
  {
    pending: { to: "printed", label: "Mark printed" },
    in_progress: { to: "printed", label: "Mark printed" },
    printed: { to: "posted", label: "Mark posted" },
    posted: { to: "delivered", label: "Mark delivered" },
  };

/** The active job statuses whose posting deadline still matters. */
const OPEN_STATUSES: FulfillmentJobStatus[] = ["pending", "in_progress", "printed"];

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
  lines,
  shippingEnabled,
  clickAndDropEnabled,
}: {
  lines: AdminOrderLine[];
  shippingEnabled: boolean;
  clickAndDropEnabled: boolean;
}) {
  const router = useRouter();
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printCards, setPrintCards] = useState<PrintRunCard[] | null>(null);
  const [printLoading, setPrintLoading] = useState(false);

  const jobIds = lines.flatMap((l) => (l.jobId ? [l.jobId] : []));
  const printedIds = lines.flatMap((l) => (l.jobId && l.jobStatus === "printed" ? [l.jobId] : []));
  const postedIds = lines.flatMap((l) => (l.jobId && l.jobStatus === "posted" ? [l.jobId] : []));
  const busy = busyJob !== null || bulkBusy !== null;

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
        const tracking = window.prompt("Tracking reference (optional):") ?? "";
        if (tracking.trim()) body.trackingReference = tracking.trim();
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
                  <Printer className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden /> Print
                  sheet ({jobIds.length})
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
                  <Truck className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden /> Dispatch
                  all ({printedIds.length})
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
              onClick={() => void runBulk("delivered", () => bulkTransition(postedIds, "delivered"))}
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
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
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
                      <span
                        className={
                          overdue ? "font-medium text-red-600 dark:text-red-400" : "text-muted"
                        }
                      >
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
                        <span
                          title={line.clickAndDropError}
                          className="text-amber-700 dark:text-amber-400"
                        >
                          ⚠ Click &amp; Drop import failed
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
                              <Truck className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />{" "}
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

      {printCards && (
        <PrintRunOverlay cards={printCards} onClose={() => setPrintCards(null)} />
      )}
    </section>
  );
}
