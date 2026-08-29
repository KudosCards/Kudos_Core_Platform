"use client";

import { Calendar, Plug, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type {
  CardSize,
  ClickAndDropImportStatus,
  DesignDocument,
  DueFilter,
  FulfillmentCounts,
} from "@kudos/shared-types";
import {
  applyMergeTokens,
  OPEN_FULFILLMENT_STATUSES,
  royalMailTrackingUrl,
} from "@kudos/shared-types";
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
  /** Fulfilment milestone timestamps (ISO strings over the wire), for the
   * per-card status trail. Each is null until that step happens. See ADR 0122. */
  printedAt: string | null;
  postedAt: string | null;
  deliveredAt: string | null;
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

/** The statuses a card can still be posted from — the ones a dispatch deadline
 * is still a live question for. The same list the API and the ops cockpit use,
 * defined once so the three cannot drift on it. See ADR 0108 §5. */
const OPEN_STATUS_TABS: readonly FulfillmentStatus[] = OPEN_FULFILLMENT_STATUSES;

/** The due-date urgency filters, in the order the print/post team works them.
 * `key` matches the API's `due` param and the counts.due bucket. They ask a
 * deadline question, which spans every still-open card rather than one status —
 * so they are shown on the open tabs, and choosing one releases the status pin.
 * See ADR 0108 §5. */
const DUE_TABS: { key: DueFilter; label: string; bucket: keyof FulfillmentCounts["due"] | null }[] =
  [
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
    return { label: "No date", className: "bg-black/5 text-foreground/50" };
  }
  if (workingDaysUntilDue < 0) {
    const n = Math.abs(workingDaysUntilDue);
    return {
      label: `Overdue ${n}wd`,
      className: "bg-red-100 text-red-800",
    };
  }
  if (workingDaysUntilDue === 0) {
    return {
      label: "Due today",
      className: "bg-amber-100 text-amber-900",
    };
  }
  if (workingDaysUntilDue <= 5) {
    return {
      label: `Due in ${workingDaysUntilDue}wd`,
      className: "bg-amber-50 text-amber-800",
    };
  }
  return {
    label: `Due in ${workingDaysUntilDue}wd`,
    className: "bg-emerald-50 text-emerald-800",
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

/**
 * A pinned dispatch-calendar day (YYYY-MM-DD) rendered for the banner.
 *
 * Assembled from parts rather than taken from `toLocaleDateString` whole,
 * because the full en-GB pattern is not stable across ICU versions: Node 22
 * (ICU 78) renders "Friday, 28 August 2026" and Chromium "Friday 28 August
 * 2026". The banner is server-rendered, so the two disagreeing threw a
 * hydration error on every calendar drill-in and made React throw the subtree
 * away and redo it. The part *names* are stable, so this still speaks ICU's
 * English — only the punctuation between them is ours.
 */
function formatDueOn(dueOn: string): string {
  const [y, m, d] = dueOn.split("-").map(Number);
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(Date.UTC(y!, m! - 1, d!)));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`;
}

/** A concise date+time for an import sample's timestamp (arrives as an ISO
 * string over the wire). */
function formatSampleDate(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A short "3 Aug" day label for a milestone timestamp; empty for null/invalid. */
function fmtDay(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * A compact fulfilment trail for one card: the milestones that have happened,
 * each with its day — "Printed 3 Aug · Posted 4 Aug · Delivered 5 Aug". Rendered
 * straight from the row's `*At` fields (the same audited timestamps the state
 * machine stamps), so it needs no extra fetch. Shown once a card has left the
 * pending queue; nothing renders while it's only pending. See ADR 0122.
 */
function StatusTrail({ job }: { job: FulfillmentJob }) {
  const steps: { label: string; at: string | null }[] = [
    { label: "Printed", at: job.printedAt },
    { label: "Posted", at: job.postedAt },
    { label: "Delivered", at: job.deliveredAt },
  ];
  const reached = steps.filter((s) => s.at);
  if (reached.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-foreground/50">
      {reached.map((s, i) => (
        <span key={s.label}>
          {i > 0 && " · "}
          <span className="font-medium text-foreground/70">{s.label}</span> {fmtDay(s.at)}
        </span>
      ))}
    </p>
  );
}

export function FulfillmentClient({
  initialJobs,
  status,
  due,
  counts,
  dueOn,
  defaultPrintSize,
}: {
  initialJobs: FulfillmentJob[];
  /** The active status tab, or null when a calendar day is pinned with no
   * explicit status (the queue then shows every open card for that day). */
  status: FulfillmentStatus | null;
  /** The active deadline filter, or null on the landing view. */
  due: DueFilter | null;
  counts: FulfillmentCounts;
  /** The dispatch-calendar drill-in day (YYYY-MM-DD), or null. See ADR 0110. */
  dueOn: string | null;
  /** The card size the print overlay opens on (super-admin default); ops can
   * still switch per run. See ADR 0138. */
  defaultPrintSize: CardSize;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  // Resync the rendered list whenever the server sends a fresh render (a new
  // `initialJobs` reference — e.g. after the mount/focus `router.refresh()`
  // below, or a navigation). Done at render time (React's documented "adjust
  // state when a prop changes" pattern) rather than in an effect, so it can't
  // trigger a cascading render or briefly show the stale list.
  const [renderedFrom, setRenderedFrom] = useState(initialJobs);
  if (renderedFrom !== initialJobs) {
    setRenderedFrom(initialJobs);
    setJobs(initialJobs);
  }
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
  // Import-status readout: how many cards have imported / errored / are awaiting,
  // with sample references to confirm in the dashboard. See ADR 0114.
  const [cndStatus, setCndStatus] = useState<ClickAndDropImportStatus | null>(null);
  const [cndStatusLoading, setCndStatusLoading] = useState(false);

  // The queue reflects data that changes from *background* events — the Click &
  // Drop sweep importing cards, new paid orders, the auto-send cron — not just
  // the operator's own clicks. The app-shell Router Cache (next.config
  // staleTimes.dynamic=30s) would otherwise serve a stale queue on a client-side
  // navigation (e.g. a just-printed card missing until a hard refresh), because
  // no operator mutation ever bust it. So re-pull fresh server state on mount and
  // whenever the tab regains focus, and (below) keep the rendered list in step
  // with each fresh server render so the queue is always live.
  useEffect(() => {
    router.refresh();
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    // Mount + focus only — `router` is stable, so this runs once and never loops
    // (a data-dep here would re-fire on every refresh's new `initialJobs`).
  }, [router]);

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
    clientApiFetch<ClickAndDropImportStatus>("/fulfillment/click-and-drop/import-status")
      .then((s) => {
        if (active) setCndStatus(s);
      })
      .catch(() => {
        /* non-fatal: the readout is a diagnostic */
      });
    return () => {
      active = false;
    };
  }, []);

  /** Reload the Click & Drop import-status readout (the ↻ button + after a manual
   * retry, so the counts + samples reflect the latest push). */
  async function loadImportStatus() {
    setCndStatusLoading(true);
    try {
      const s = await clientApiFetch<ClickAndDropImportStatus>(
        "/fulfillment/click-and-drop/import-status",
      );
      setCndStatus(s);
    } catch {
      /* non-fatal: the readout is a diagnostic */
    } finally {
      setCndStatusLoading(false);
    }
  }

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
        const verdict = r.ok ? "connected" : "failed";
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

  /** Retry importing a card into Click & Drop after a failed push, by job id.
   * Forces an immediate re-push (bypassing the sweep's retry cooldown), patches
   * the row if it's on screen, and refreshes the readout. Shared by the queue-row
   * button and the "Retry now" button in the import-status error panel. */
  async function retryClickAndDropById(jobId: string) {
    setError(null);
    setCndRetryId(jobId);
    try {
      const updated = await clientApiFetch<FulfillmentJob>(
        `/fulfillment/jobs/${jobId}/click-and-drop`,
        { method: "POST" },
      );
      setJobs((current) => current.map((j) => (j.id === jobId ? { ...j, ...updated } : j)));
      // The card just moved bands (errored/awaiting → imported), so refresh the
      // readout counts + samples.
      void loadImportStatus();
    } catch (retryError) {
      setError(
        retryError instanceof ApiError ? retryError.message : "Could not import to Click & Drop",
      );
    } finally {
      setCndRetryId(null);
    }
  }

  function retryClickAndDrop(job: FulfillmentJob) {
    return retryClickAndDropById(job.id);
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
        dispatchError instanceof ApiError
          ? dispatchError.message
          : "Could not dispatch via Royal Mail",
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
      setError(
        printError instanceof ApiError ? printError.message : "Could not build the print run",
      );
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
    // A deadline narrows an open tab, and the lit chip shows it doing so. On a
    // closed tab the chips are hidden — a posted card's deadline has nothing
    // left to say — so carrying the filter there would cut the list with
    // nothing on screen to say why, leaving it to disagree with the count on
    // the tab itself. Drop it instead. (A pinned day is different: its banner
    // is shown whatever the tab, so it is never a silent filter.)
    else if (due && OPEN_STATUS_TABS.includes(tab)) params.set("due", due);
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
            className="rounded-full border border-black/15 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40"
          >
            {cndTesting ? (
              "Testing…"
            ) : (
              <>
                <Plug className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden /> Test Click &
                Drop
              </>
            )}
          </button>
          <a
            href="/fulfillment/calendar"
            className="rounded-full border border-black/15 px-4 py-1.5 text-sm hover:bg-black/5"
          >
            <Calendar className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden /> Dispatch
            calendar
          </a>
        </div>
      </div>

      {cndTestResult && (
        <pre className="max-w-full overflow-x-auto rounded-lg border border-black/10 bg-black/[0.03] p-3 text-xs whitespace-pre-wrap">
          {cndTestResult}
        </pre>
      )}

      {/* Import-status readout: where our cards stand relative to Click & Drop, so
          an operator can confirm our ORD-… orders are landing in the dashboard
          (vs any legacy WooCommerce #NNNN orders on the same account). ADR 0114. */}
      {cndStatus && (
        <div className="rounded-xl border border-black/10 bg-black/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Click & Drop import status</h2>
              {!cndStatus.enabled && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700">
                  not configured
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void loadImportStatus()}
              disabled={cndStatusLoading}
              className="rounded-full border border-black/15 px-3 py-1 text-xs hover:bg-black/5 disabled:opacity-40"
            >
              {cndStatusLoading ? "Refreshing…" : "↻ Refresh"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-lg bg-emerald-500/[0.12] px-3 py-1 text-emerald-700">
              Imported <strong className="tabular-nums">{cndStatus.imported}</strong>
            </span>
            <span className="rounded-lg bg-rose-500/[0.12] px-3 py-1 text-rose-700">
              Errored <strong className="tabular-nums">{cndStatus.errored}</strong>
            </span>
            <span className="rounded-lg bg-black/[0.05] px-3 py-1">
              Awaiting <strong className="tabular-nums">{cndStatus.awaiting}</strong>
            </span>
          </div>

          {cndStatus.recentImports.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-foreground/60">
                Recently imported — search these references in your Click & Drop dashboard to
                confirm our orders land in the right account:
              </p>
              <ul className="mt-1.5 space-y-1 text-xs">
                {cndStatus.recentImports.map((sample) => (
                  <li key={sample.jobId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <code className="rounded bg-black/[0.06] px-1.5 py-0.5">
                      {sample.orderReference}
                    </code>
                    <span className="text-foreground/50">→ RM order {sample.orderIdentifier}</span>
                    {sample.importedAt && (
                      <span className="text-foreground/40">
                        · imported {formatSampleDate(sample.importedAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cndStatus.recentErrors.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-foreground/60">Most recent import errors:</p>
              <ul className="mt-1.5 space-y-1 text-xs">
                {cndStatus.recentErrors.map((sample) => (
                  <li key={sample.jobId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <code className="rounded bg-black/[0.06] px-1.5 py-0.5">
                      {sample.orderReference}
                    </code>
                    <span className="text-rose-600">{sample.error}</span>
                    {clickAndDropEnabled && (
                      <button
                        type="button"
                        disabled={cndRetryId === sample.jobId}
                        onClick={() => void retryClickAndDropById(sample.jobId)}
                        className="rounded-full border border-black/20 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40"
                      >
                        {cndRetryId === sample.jobId ? "Retrying…" : "Retry now"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cndStatus.imported === 0 && cndStatus.errored === 0 && cndStatus.awaiting === 0 && (
            <p className="mt-3 text-xs text-foreground/50">
              No fulfillment jobs yet — nothing to import.
            </p>
          )}
        </div>
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

      {/* A deadline view spans the open statuses, so no status tab is lit. Say
          so, rather than leaving the operator to wonder which tab they are on. */}
      {!dueOn && due && !status && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <span>
            {due === "all" ? (
              <>
                Showing <strong>every card still to post</strong> — pending, in progress and
                printed.
              </>
            ) : (
              <>
                Showing <strong>{DUE_TABS.find((t) => t.key === due)?.label.toLowerCase()}</strong>{" "}
                cards · all still to post, whether pending, in progress or printed.
              </>
            )}
          </span>
          <a href="/fulfillment" className="text-muted hover:text-accent">
            Show whole queue
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => router.push(statusHref(tab))}
            className={`flex items-center gap-2 rounded-full px-3 py-1 capitalize ${
              tab === status ? "bg-accent text-white" : "border border-black/15 hover:bg-black/5"
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

      {/* Dispatch-urgency filter. A deadline is a question about work still to
          go out, so the chips count every open card and choosing one releases
          the status pin — matching the dispatch calendar and the send-by-5
          banner. Shown on the open tabs and on a deadline view; hidden on a
          calendar day drill-in, whose own date already scopes the list, and on
          the closed tabs, where a deadline has nothing left to say. Sorted
          soonest-deadline-first regardless. */}
      {!dueOn && (status === null || OPEN_STATUS_TABS.includes(status)) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs uppercase tracking-wide text-foreground/40">
            By dispatch date
          </span>
          {DUE_TABS.map((tab) => {
            const count = tab.bucket ? counts.due[tab.bucket] : null;
            const active = tab.key === due;
            const urgent = tab.key === "overdue" && (count ?? 0) > 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => router.push(`/fulfillment?due=${tab.key}`)}
                className={`flex items-center gap-2 rounded-full px-3 py-1 ${
                  active
                    ? "bg-foreground text-background"
                    : urgent
                      ? "border border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
                      : "border border-black/15 hover:bg-black/5"
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
            className="rounded-full border border-black/20 px-4 py-1.5 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exportPending ? "Exporting…" : `Export addresses (${selected.size})`}
          </button>
          <button
            type="button"
            disabled={printPending || selected.size === 0}
            onClick={() => void printRun()}
            className="rounded-full border border-black/20 px-4 py-1.5 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
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
                className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(job.id)}
                    onChange={() => toggle(job.id)}
                  />
                  <div>
                    {OPEN_STATUS_TABS.includes(job.status) &&
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
                      {job.trackingReference && (
                        <>
                          {" · "}
                          <a
                            href={royalMailTrackingUrl(job.trackingReference)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Track this item on Royal Mail"
                            className="text-accent hover:underline"
                          >
                            Track {job.trackingReference}
                          </a>
                        </>
                      )}
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
                    <StatusTrail job={job} />
                    {clickAndDropEnabled && (
                      <p className="mt-1 text-xs">
                        {job.clickAndDropOrderId ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                            ✓ In Click & Drop
                          </span>
                        ) : job.clickAndDropError ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span
                              title={job.clickAndDropError}
                              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800"
                            >
                              ⚠️ Click & Drop import failed
                            </span>
                            <button
                              type="button"
                              disabled={cndRetryId === job.id}
                              onClick={() => void retryClickAndDrop(job)}
                              className="rounded-full border border-black/20 px-2 py-0.5 hover:bg-black/5 disabled:opacity-40"
                            >
                              {cndRetryId === job.id ? "Retrying…" : "Retry"}
                            </button>
                          </span>
                        ) : (
                          <span className="text-foreground/50">Importing to Click & Drop…</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:justify-end">
                  <button
                    type="button"
                    disabled={previewLoadingId === job.id}
                    onClick={() => void openPreview(job.id)}
                    className="rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40"
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
                      {pendingId === job.id ? (
                        "…"
                      ) : (
                        <>
                          <Truck className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden />{" "}
                          Dispatch (Royal Mail)
                        </>
                      )}
                    </button>
                  )}
                  {step && (
                    <button
                      type="button"
                      disabled={pendingId === job.id}
                      onClick={() => void advance(job)}
                      className="rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
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
                          className="rounded-full border border-black/20 px-3 py-1.5 text-sm"
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
                          className="rounded-full border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReturningId(job.id)}
                        className="rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5"
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
              recipient’s name merged in.
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
        <PrintRunOverlay
          cards={printCards}
          defaultSize={defaultPrintSize}
          onClose={() => setPrintCards(null)}
        />
      )}
    </div>
  );
}
