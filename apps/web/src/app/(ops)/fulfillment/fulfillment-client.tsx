"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { DesignDocument, DueFilter, FulfillmentCounts } from "@kudos/shared-types";
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
  labelUrl: string | null;
  /** The date this card must be posted by (the occasion's dispatch date), or
   * null when it has no dated deadline. See ADR 0108. */
  dueDate: string | null;
  /** Working days until it must post: negative = overdue, 0 = today, null =
   * no dated deadline. Computed server-side (only the API holds the UK holiday
   * calendar); the badge is rendered straight from this. */
  workingDaysUntilDue: number | null;
  /** Royal Mail's id once this card is imported into Click & Drop; null until
   * the sweep pushes it (or if import is off). See ADR 0095. */
  clickAndDropOrderId: string | null;
  /** The last Click & Drop import error, shown with a retry action. */
  clickAndDropError: string | null;
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

/** The due-date urgency filters, in the order the print/post team works them.
 * `key` matches the API's `due` param and the counts.due bucket; shown only on
 * the actionable `pending` queue (where the buckets are computed). See ADR 0108. */
const DUE_TABS: { key: DueFilter; label: string; bucket: keyof FulfillmentCounts["due"] | null }[] = [
  { key: "all", label: "All", bucket: null },
  { key: "overdue", label: "Overdue", bucket: "overdue" },
  { key: "today", label: "Due today", bucket: "today" },
  { key: "due_soon", label: "Due soon", bucket: "dueSoon" },
  { key: "upcoming", label: "Upcoming", bucket: "upcoming" },
  { key: "no_date", label: "No date", bucket: "noDate" },
];

/** The colour-coded deadline badge for a queue row, from the server-computed
 * working-days-until-due. Red overdue, amber this week, neutral beyond, grey
 * when the card has no dated deadline. */
function dueBadge(workingDaysUntilDue: number | null): { label: string; className: string } {
  if (workingDaysUntilDue === null) {
    return { label: "No date", className: "bg-black/5 text-foreground/50 dark:bg-white/10" };
  }
  if (workingDaysUntilDue < 0) {
    const n = Math.abs(workingDaysUntilDue);
    return {
      label: `Overdue ${n}wd`,
      className: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
    };
  }
  if (workingDaysUntilDue === 0) {
    return {
      label: "Due today",
      className: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
    };
  }
  if (workingDaysUntilDue <= 5) {
    return {
      label: `Due in ${workingDaysUntilDue}wd`,
      className: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200",
    };
  }
  return {
    label: `Due in ${workingDaysUntilDue}wd`,
    className: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  };
}

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

/** A pinned dispatch-calendar day (YYYY-MM-DD) rendered for the banner. */
function formatDueOn(dueOn: string): string {
  const [y, m, d] = dueOn.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function FulfillmentClient({
  initialJobs,
  status,
  due,
  counts,
  dueOn,
}: {
  initialJobs: FulfillmentJob[];
  /** The active status tab, or null when a calendar day is pinned with no
   * explicit status (the queue then shows every open card for that day). */
  status: FulfillmentStatus | null;
  due: DueFilter;
  counts: FulfillmentCounts;
  /** The dispatch-calendar drill-in day (YYYY-MM-DD), or null. See ADR 0110. */
  dueOn: string | null;
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
  // Whether Royal Mail shipping automation is wired — gates the auto-dispatch
  // action (falls back to manual "Mark posted" when off). See ADR 0072.
  const [shippingEnabled, setShippingEnabled] = useState(false);

  // Whether Click & Drop order-import is wired — gates the import status chip +
  // retry action. See ADR 0095.
  const [clickAndDropEnabled, setClickAndDropEnabled] = useState(false);
  const [cndRetryId, setCndRetryId] = useState<string | null>(null);
  // Live Click & Drop connectivity probe (ops diagnostic).
  const [cndTesting, setCndTesting] = useState(false);
  const [cndTestResult, setCndTestResult] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    clientApiFetch<{ enabled: boolean }>("/fulfillment/shipping-status")
      .then((r) => {
        if (active) setShippingEnabled(r.enabled);
      })
      .catch(() => {
        /* non-fatal: manual dispatch still works */
      });
    clientApiFetch<{ enabled: boolean }>("/fulfillment/click-and-drop-status")
      .then((r) => {
        if (active) setClickAndDropEnabled(r.enabled);
      })
      .catch(() => {
        /* non-fatal: the sweep still imports automatically */
      });
    return () => {
      active = false;
    };
  }, []);

  /** Fire a live read-only Click & Drop probe and show the raw status + body, so
   * a bad key / base URL is diagnosable from the console. See ADR 0113. */
  async function testClickAndDrop() {
    setCndTesting(true);
    setCndTestResult(null);
    try {
      const r = await clientApiFetch<{
        enabled: boolean;
        ok: boolean;
        status: number;
        body: string;
        endpoint: string;
        authScheme: string;
        error?: string;
      }>("/fulfillment/click-and-drop/test", { method: "POST" });
      if (!r.enabled) {
        setCndTestResult("Click & Drop is not configured (no API key set).");
      } else {
        const verdict = r.ok ? "✅ connected" : "❌ failed";
        const detail = r.error ? `network error: ${r.error}` : `body: ${r.body || "(empty)"}`;
        setCndTestResult(
          `${verdict} · HTTP ${r.status} · ${r.authScheme} auth · ${r.endpoint}\n${detail}`,
        );
      }
    } catch (testError) {
      setCndTestResult(
        testError instanceof ApiError ? testError.message : "Could not run the connection test",
      );
    } finally {
      setCndTesting(false);
    }
  }

  /** Retry importing a card into Click & Drop after a failed push, patching the
   * refreshed row in place. */
  async function retryClickAndDrop(job: FulfillmentJob) {
    setError(null);
    setCndRetryId(job.id);
    try {
      const updated = await clientApiFetch<FulfillmentJob>(
        `/fulfillment/jobs/${job.id}/click-and-drop`,
        { method: "POST" },
      );
      setJobs((current) => current.map((j) => (j.id === job.id ? { ...j, ...updated } : j)));
    } catch (retryError) {
      setError(
        retryError instanceof ApiError ? retryError.message : "Could not import to Click & Drop",
      );
    } finally {
      setCndRetryId(null);
    }
  }

  /** Auto-create a Royal Mail shipment for a printed card (buys postage,
   * allocates tracking + label) and mark it posted — no manual tracking entry. */
  async function dispatchViaRoyalMail(job: FulfillmentJob) {
    setError(null);
    setPendingId(job.id);
    try {
      await clientApiFetch(`/fulfillment/jobs/${job.id}/dispatch`, { method: "POST" });
      removeJob(job.id);
    } catch (dispatchError) {
      setError(
        dispatchError instanceof ApiError ? dispatchError.message : "Could not dispatch via Royal Mail",
      );
    } finally {
      setPendingId(null);
    }
  }

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

  // A single forward step only makes sense when one status is in view. On a
  // day drill-in with mixed open statuses (status null) bulk-advance is hidden.
  const bulkStep = status ? NEXT_STEP[status] : undefined;

  /** A status-tab href that keeps the pinned calendar day, so the tabs narrow
   * within the day rather than jumping back to the whole queue. */
  function statusHref(tab: FulfillmentStatus): string {
    const params = new URLSearchParams({ status: tab });
    if (dueOn) params.set("dueOn", dueOn);
    return `/fulfillment?${params.toString()}`;
  }

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fulfillment queue</h1>
          <p className="text-foreground/60">Print, post, and track cards across all accounts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void testClickAndDrop()}
            disabled={cndTesting}
            title="Fire one live read-only call to Royal Mail Click & Drop to check the API key + connection"
            className="rounded-full border border-black/15 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5"
          >
            {cndTesting ? "Testing…" : "🔌 Test Click & Drop"}
          </button>
          <a
            href="/fulfillment/calendar"
            className="rounded-full border border-black/15 px-4 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
          >
            📅 Dispatch calendar
          </a>
        </div>
      </div>

      {cndTestResult && (
        <pre className="max-w-full overflow-x-auto rounded-lg border border-black/10 bg-black/[0.03] p-3 text-xs whitespace-pre-wrap dark:border-white/10 dark:bg-white/[0.03]">
          {cndTestResult}
        </pre>
      )}

      {dueOn && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <span>
            Showing cards due <strong>{formatDueOn(dueOn)}</strong>
            {status ? ` · ${status.replaceAll("_", " ")}` : " · all still to post"}.
          </span>
          <div className="flex items-center gap-3">
            <a href="/fulfillment/calendar" className="text-accent hover:underline">
              ← Calendar
            </a>
            <a href="/fulfillment" className="text-muted hover:text-accent">
              Show whole queue
            </a>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => router.push(statusHref(tab))}
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
              {counts.status[tab] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Dispatch-urgency filter — only on the actionable pending queue, where the
          due buckets are computed. Hidden on a calendar day drill-in, whose own
          date already scopes the list. Sorted soonest-deadline-first regardless. */}
      {status === "pending" && !dueOn && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs uppercase tracking-wide text-foreground/40">By dispatch date</span>
          {DUE_TABS.map((tab) => {
            const count = tab.bucket ? counts.due[tab.bucket] : null;
            const active = tab.key === due;
            const urgent = tab.key === "overdue" && (count ?? 0) > 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => router.push(`/fulfillment?status=pending&due=${tab.key}`)}
                className={`flex items-center gap-2 rounded-full px-3 py-1 ${
                  active
                    ? "bg-foreground text-background"
                    : urgent
                      ? "border border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
                      : "border border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
                }`}
              >
                <span>{tab.label}</span>
                {count !== null && (
                  <span
                    className={`tabular-nums ${active ? "text-background/70" : "text-foreground/50"}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

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
                    {["pending", "in_progress", "printed"].includes(job.status) &&
                      (() => {
                        const badge = dueBadge(job.workingDaysUntilDue);
                        return (
                          <span
                            className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        );
                      })()}
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
                      {job.labelUrl && (
                        <>
                          {" · "}
                          <a
                            href={job.labelUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            Print label
                          </a>
                        </>
                      )}
                    </p>
                    {clickAndDropEnabled && (
                      <p className="mt-1 text-xs">
                        {job.clickAndDropOrderId ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                            ✓ In Click &amp; Drop
                          </span>
                        ) : job.clickAndDropError ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span
                              title={job.clickAndDropError}
                              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                            >
                              ⚠️ Click &amp; Drop import failed
                            </span>
                            <button
                              type="button"
                              disabled={cndRetryId === job.id}
                              onClick={() => void retryClickAndDrop(job)}
                              className="rounded-full border border-black/20 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
                            >
                              {cndRetryId === job.id ? "Retrying…" : "Retry"}
                            </button>
                          </span>
                        ) : (
                          <span className="text-foreground/50">Importing to Click &amp; Drop…</span>
                        )}
                      </p>
                    )}
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
                  {shippingEnabled && job.status === "printed" && (
                    <button
                      type="button"
                      disabled={pendingId === job.id}
                      onClick={() => void dispatchViaRoyalMail(job)}
                      title="Create a Royal Mail shipment, buy postage, and get a tracking number"
                      className="rounded-full border border-accent bg-accent-soft px-4 py-1.5 text-sm font-medium text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {pendingId === job.id ? "…" : "🚚 Dispatch (Royal Mail)"}
                    </button>
                  )}
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
