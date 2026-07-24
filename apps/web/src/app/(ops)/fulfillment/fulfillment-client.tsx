"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { DesignDocument } from "@kudos/shared-types";
import { applyMergeTokens } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { Modal } from "@/components/modal";
import { PrintRunOverlay, type PrintRunCard } from "./print-run-overlay";
import { OCCASION_TYPE_LABELS } from "@/lib/occasions";

const CardFacePreview = dynamic(
  () => import("@/components/card-face-preview").then((m) => m.CardFacePreview),
  { ssr: false },
);

/** Single-card detail (GET /fulfillment/jobs/:id) — carries the design document
 * and recipient needed to render the personalised card the operator prints. */
interface FulfillmentJobDetail {
  id: string;
  orderRecipient: {
    recipient: {
      firstName: string;
      lastName: string;
      customFields: Record<string, string> | null;
    };
    occasion: { type: string; title: string | null; occasionDate: string } | null;
    savedDesign: { name: string; document: DesignDocument };
  };
}

/** Human occasion label for {occasion}: custom title wins, else the type
 * title-cased (e.g. "birthday" → "Birthday"). */
function occasionLabelFor(occasion: { type: string; title: string | null } | null): string | null {
  if (!occasion) return null;
  if (occasion.title) return occasion.title;
  return occasion.type.charAt(0).toUpperCase() + occasion.type.slice(1);
}

export type FulfillmentStatus =
  "pending" | "in_progress" | "printed" | "posted" | "delivered" | "returned_to_sender" | "failed";

/**
 * The queue view deliberately has NO street address — only city + postcode,
 * enough to triage a print run. Full addresses come from the audited export
 * (see exportAddresses below), not this list. Mirrors the API's QUEUE_SELECT.
 */
export interface FulfillmentJob {
  id: string;
  status: FulfillmentStatus;
  trackingReference: string | null;
  orderRecipient: {
    shippingAddressCity: string;
    shippingAddressPostcode: string;
    dispatchOption: string;
    postageClass: string;
    recipient: { firstName: string; lastName: string };
    savedDesign: { id: string; name: string };
    occasion: { type: string; occasionDate: string } | null;
  };
}

interface ExportedAddress {
  jobId: string;
  recipientFirstName: string;
  recipientLastName: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string | null;
  shippingAddressCity: string;
  shippingAddressPostcode: string;
  shippingAddressCountry: string;
  postageClass: string;
}

/** The single forward step offered for each status (bulk uses the same map). */
const NEXT_STEP: Partial<Record<FulfillmentStatus, { to: FulfillmentStatus; label: string }>> = {
  pending: { to: "printed", label: "Mark printed" },
  in_progress: { to: "printed", label: "Mark printed" },
  printed: { to: "posted", label: "Mark posted" },
  posted: { to: "delivered", label: "Mark delivered" },
};

const STATUS_TABS: FulfillmentStatus[] = [
  "pending",
  "in_progress",
  "printed",
  "posted",
  "delivered",
  "returned_to_sender",
  "failed",
];

/** RTS reasons offered when marking a posted/delivered card returned. */
const RETURN_REASONS: { value: string; label: string }[] = [
  { value: "moved", label: "Recipient has moved" },
  { value: "incomplete_address", label: "Address incomplete" },
  { value: "incorrect_address", label: "Address incorrect" },
  { value: "undeliverable", label: "Delivery not possible" },
  { value: "other", label: "Other" },
];

const POSTAGE_LABELS: Record<string, string> = {
  first_class: "1st class",
  second_class: "2nd class",
};

function csvCell(value: string): string {
  // Quote if the value contains a comma, quote, or newline; double embedded quotes.
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(rows: ExportedAddress[]): void {
  const header = ["Recipient", "Line 1", "Line 2", "City", "Postcode", "Country", "Postage"];
  const lines = rows.map((r) =>
    [
      `${r.recipientFirstName} ${r.recipientLastName}`,
      r.shippingAddressLine1,
      r.shippingAddressLine2 ?? "",
      r.shippingAddressCity,
      r.shippingAddressPostcode,
      r.shippingAddressCountry,
      r.postageClass,
    ]
      .map(csvCell)
      .join(","),
  );
  const csv = [header.join(","), ...lines].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dispatch-addresses-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function FulfillmentClient({
  initialJobs,
  status,
  counts,
}: {
  initialJobs: FulfillmentJob[];
  status: FulfillmentStatus;
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [preview, setPreview] = useState<FulfillmentJobDetail | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [printCards, setPrintCards] = useState<PrintRunCard[] | null>(null);
  const [printPending, setPrintPending] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);

  async function printRun() {
    if (selected.size === 0) return;
    setError(null);
    setPrintPending(true);
    try {
      // Audited pull of the selected cards' designs + recipients, then a
      // browser print → Save-as-PDF of the whole run, names already merged.
      const cards = await clientApiFetch<PrintRunCard[]>("/fulfillment/print-run", {
        method: "POST",
        body: JSON.stringify({ jobIds: [...selected] }),
      });
      setPrintCards(cards);
    } catch (printError) {
      setError(printError instanceof ApiError ? printError.message : "Could not build the print run");
    } finally {
      setPrintPending(false);
    }
  }

  async function openPreview(jobId: string) {
    setError(null);
    setPreviewLoadingId(jobId);
    try {
      // Audited single-card read — pulls the design document + recipient so we
      // can render the card exactly as it prints, name merged in.
      const detail = await clientApiFetch<FulfillmentJobDetail>(`/fulfillment/jobs/${jobId}`);
      setPreview(detail);
    } catch (previewError) {
      setError(previewError instanceof ApiError ? previewError.message : "Could not load the card");
    } finally {
      setPreviewLoadingId(null);
    }
  }

  function removeJob(id: string) {
    setJobs((current) => current.filter((j) => j.id !== id));
    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function advance(job: FulfillmentJob) {
    const step = NEXT_STEP[job.status];
    if (!step) return;
    setError(null);
    setPendingId(job.id);
    try {
      const body: Record<string, unknown> = { toStatus: step.to };
      if (step.to === "posted") {
        const tracking = window.prompt("Tracking reference (optional):") ?? "";
        if (tracking.trim()) body.trackingReference = tracking.trim();
      }
      await clientApiFetch(`/fulfillment/jobs/${job.id}/transition`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      // The job leaves the current status filter's view.
      removeJob(job.id);
    } catch (advanceError) {
      setError(advanceError instanceof ApiError ? advanceError.message : "Could not update job");
    } finally {
      setPendingId(null);
    }
  }

  /** Mark a posted/delivered card Returned to Sender — opens a recovery case and
   * flags the contact. The job leaves the current (posted/delivered) view. */
  async function markReturned(jobId: string, reason: string) {
    setError(null);
    setPendingId(jobId);
    try {
      await clientApiFetch("/admin/returns", {
        method: "POST",
        body: JSON.stringify({ fulfillmentJobId: jobId, reason }),
      });
      setReturningId(null);
      removeJob(jobId);
    } catch (returnError) {
      setError(returnError instanceof ApiError ? returnError.message : "Could not mark returned");
    } finally {
      setPendingId(null);
    }
  }

  const bulkStep = NEXT_STEP[status];

  async function bulkAdvance() {
    if (!bulkStep || selected.size === 0) return;
    setError(null);
    setBulkPending(true);
    try {
      await clientApiFetch("/fulfillment/jobs/bulk-transition", {
        method: "POST",
        body: JSON.stringify({ jobIds: [...selected], toStatus: bulkStep.to }),
      });
      const done = selected;
      setJobs((current) => current.filter((j) => !done.has(j.id)));
      setSelected(new Set());
    } catch (bulkError) {
      setError(bulkError instanceof ApiError ? bulkError.message : "Bulk update failed");
    } finally {
      setBulkPending(false);
    }
  }

  async function exportAddresses() {
    if (selected.size === 0) return;
    setError(null);
    setExportPending(true);
    try {
      // The full home addresses are deliberately NOT in the queue payload —
      // pulling them is an explicit, server-audited action (one audit row per
      // card). We turn them straight into a CSV the operator can mail-merge
      // into address labels for the print run.
      const rows = await clientApiFetch<ExportedAddress[]>("/fulfillment/export", {
        method: "POST",
        body: JSON.stringify({ jobIds: [...selected] }),
      });
      downloadCsv(rows);
    } catch (exportError) {
      setError(exportError instanceof ApiError ? exportError.message : "Export failed");
    } finally {
      setExportPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fulfillment queue</h1>
        <p className="text-foreground/60">Print, post, and track cards across all accounts.</p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => router.push(`/fulfillment?status=${tab}`)}
            className={`flex items-center gap-2 rounded-full px-3 py-1 capitalize ${
              tab === status
                ? "bg-accent text-white"
                : "border border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
            }`}
          >
            <span>{tab.replaceAll("_", " ")}</span>
            <span
              className={`tabular-nums ${tab === status ? "text-white/80" : "text-foreground/50"}`}
            >
              {counts[tab] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {jobs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            disabled={exportPending || selected.size === 0}
            onClick={() => void exportAddresses()}
            className="rounded-full border border-black/20 px-4 py-1.5 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
          >
            {exportPending ? "Exporting…" : `Export addresses (${selected.size})`}
          </button>
          <button
            type="button"
            disabled={printPending || selected.size === 0}
            onClick={() => void printRun()}
            className="rounded-full border border-black/20 px-4 py-1.5 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
          >
            {printPending ? "Preparing…" : `Print sheet (${selected.size})`}
          </button>
          {bulkStep && (
            <button
              type="button"
              disabled={bulkPending || selected.size === 0}
              onClick={() => void bulkAdvance()}
              className="rounded-full bg-foreground px-4 py-1.5 text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkPending ? "Working…" : `${bulkStep.label} (${selected.size})`}
            </button>
          )}
        </div>
      )}

      {jobs.length === 0 ? (
        <p className="text-sm text-foreground/60">Nothing in this queue.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => {
            const r = job.orderRecipient;
            const step = NEXT_STEP[job.status];
            return (
              <div
                key={job.id}
                className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 sm:flex-row sm:items-start sm:justify-between dark:border-white/10"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(job.id)}
                    onChange={() => toggle(job.id)}
                  />
                  <div>
                    <p className="font-medium">
                      {r.recipient.firstName} {r.recipient.lastName}
                      {r.occasion && (
                        <span className="text-foreground/60">
                          {" · "}
                          {OCCASION_TYPE_LABELS[r.occasion.type] ?? r.occasion.type}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-foreground/70">
                      {r.shippingAddressCity} {r.shippingAddressPostcode}
                    </p>
                    <p className="text-xs text-foreground/50">
                      Design: {r.savedDesign.name} ·{" "}
                      {POSTAGE_LABELS[r.postageClass] ?? r.postageClass}
                      {job.trackingReference && ` · ${job.trackingReference}`}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 self-start">
                  <button
                    type="button"
                    disabled={previewLoadingId === job.id}
                    onClick={() => void openPreview(job.id)}
                    className="rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
                  >
                    {previewLoadingId === job.id ? "…" : "Preview card"}
                  </button>
                  {step && (
                    <button
                      type="button"
                      disabled={pendingId === job.id}
                      onClick={() => void advance(job)}
                      className="rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
                    >
                      {pendingId === job.id ? "…" : step.label}
                    </button>
                  )}
                  {(job.status === "posted" || job.status === "delivered") &&
                    (returningId === job.id ? (
                      <div className="flex items-center gap-1">
                        <select
                          aria-label="Return reason"
                          defaultValue="moved"
                          id={`rts-reason-${job.id}`}
                          className="rounded-full border border-black/20 px-3 py-1.5 text-sm dark:border-white/20"
                        >
                          {RETURN_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={pendingId === job.id}
                          onClick={() => {
                            const select = document.getElementById(
                              `rts-reason-${job.id}`,
                            ) as HTMLSelectElement | null;
                            void markReturned(job.id, select?.value ?? "other");
                          }}
                          className="rounded-full border border-amber-400 bg-amber-50 px-4 py-1.5 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                        >
                          {pendingId === job.id ? "…" : "Confirm return"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setReturningId(null)}
                          className="rounded-full border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReturningId(job.id)}
                        className="rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5"
                      >
                        Returned to sender
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <Modal
          open
          onClose={() => setPreview(null)}
          title={`${preview.orderRecipient.recipient.firstName} ${preview.orderRecipient.recipient.lastName}`}
        >
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-foreground/60">
              {preview.orderRecipient.savedDesign.name} — printed exactly as shown, with this
              recipient&apos;s name merged in.
            </p>
            <CardFacePreview
              document={applyMergeTokens(preview.orderRecipient.savedDesign.document, {
                firstName: preview.orderRecipient.recipient.firstName,
                lastName: preview.orderRecipient.recipient.lastName,
                occasion: occasionLabelFor(preview.orderRecipient.occasion),
                occasionDate: preview.orderRecipient.occasion?.occasionDate ?? null,
                customFields: preview.orderRecipient.recipient.customFields,
              })}
              width={300}
            />
          </div>
        </Modal>
      )}

      {printCards && (
        <PrintRunOverlay cards={printCards} onClose={() => setPrintCards(null)} />
      )}
    </div>
  );
}
