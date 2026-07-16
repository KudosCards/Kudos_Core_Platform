"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { OCCASION_TYPE_LABELS } from "@/lib/occasions";

export type FulfillmentStatus =
  "pending" | "in_progress" | "printed" | "posted" | "delivered" | "failed";

export interface FulfillmentJob {
  id: string;
  status: FulfillmentStatus;
  trackingReference: string | null;
  orderRecipient: {
    shippingAddressLine1: string;
    shippingAddressLine2: string | null;
    shippingAddressCity: string;
    shippingAddressPostcode: string;
    shippingAddressCountry: string;
    dispatchOption: string;
    postageClass: string;
    recipient: { firstName: string; lastName: string };
    savedDesign: { id: string; name: string };
    occasion: { type: string; occasionDate: string } | null;
  };
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
  "failed",
];

const POSTAGE_LABELS: Record<string, string> = {
  first_class: "1st class",
  second_class: "2nd class",
};

export function FulfillmentClient({
  initialJobs,
  status,
}: {
  initialJobs: FulfillmentJob[];
  status: FulfillmentStatus;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);

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
            className={`rounded-full px-3 py-1 ${
              tab === status
                ? "bg-foreground text-background"
                : "border border-black/15 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
            }`}
          >
            {tab.replace("_", " ")}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {bulkStep && jobs.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={bulkPending || selected.size === 0}
            onClick={() => void bulkAdvance()}
            className="rounded-full bg-foreground px-4 py-1.5 text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {bulkPending ? "Working…" : `${bulkStep.label} for ${selected.size} selected`}
          </button>
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
                  {bulkStep && (
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(job.id)}
                      onChange={() => toggle(job.id)}
                    />
                  )}
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
                      {r.shippingAddressLine1}
                      {r.shippingAddressLine2 ? `, ${r.shippingAddressLine2}` : ""},{" "}
                      {r.shippingAddressCity} {r.shippingAddressPostcode}
                    </p>
                    <p className="text-xs text-foreground/50">
                      Design: {r.savedDesign.name} ·{" "}
                      {POSTAGE_LABELS[r.postageClass] ?? r.postageClass}
                      {job.trackingReference && ` · ${job.trackingReference}`}
                    </p>
                  </div>
                </div>

                {step && (
                  <button
                    type="button"
                    disabled={pendingId === job.id}
                    onClick={() => void advance(job)}
                    className="shrink-0 self-start rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
                  >
                    {pendingId === job.id ? "…" : step.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
