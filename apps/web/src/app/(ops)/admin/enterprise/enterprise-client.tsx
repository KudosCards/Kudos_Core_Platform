"use client";

import { useState } from "react";
import type { EnterpriseEnquiry, EnterpriseEnquiryStatus } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

const STATUS_LABELS: Record<EnterpriseEnquiryStatus, string> = {
  new: "New",
  in_progress: "In progress",
  closed: "Closed",
};

const STATUS_CLASSES: Record<EnterpriseEnquiryStatus, string> = {
  new: "bg-amber-100 text-amber-800",
  in_progress: "bg-sky-100 text-sky-800",
  closed: "bg-black/5 text-foreground/60 dark:bg-white/10",
};

/** The next status a lead can move to, with the button label. */
const NEXT_ACTIONS: Record<EnterpriseEnquiryStatus, { to: EnterpriseEnquiryStatus; label: string }[]> = {
  new: [
    { to: "in_progress", label: "Start" },
    { to: "closed", label: "Close" },
  ],
  in_progress: [
    { to: "closed", label: "Close" },
    { to: "new", label: "Reopen" },
  ],
  closed: [{ to: "in_progress", label: "Reopen" }],
};

function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The ops Enterprise-leads queue. Lists enquiries from the public "Contact us"
 * form with the full detail inline (nothing to drill into) and status controls
 * to work each lead. See docs/adr/0101-enterprise-plan-enquiries.md.
 */
export function EnterpriseLeadsClient({ initialItems }: { initialItems: EnterpriseEnquiry[] }) {
  const [items, setItems] = useState<EnterpriseEnquiry[]>(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(id: string, status: EnterpriseEnquiryStatus) {
    setError(null);
    setPendingId(id);
    try {
      const updated = await clientApiFetch<EnterpriseEnquiry>(`/admin/enterprise-enquiries/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
    } catch (updateError) {
      setError(updateError instanceof ApiError ? updateError.message : "Could not update the lead");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-black/10 p-8 text-center text-sm text-foreground/60 dark:border-white/10">
        No enquiries here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}
      {items.map((lead) => (
        <div
          key={lead.id}
          className="flex flex-col gap-3 rounded-xl border border-black/10 p-5 dark:border-white/10"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <p className="font-semibold">{lead.organisation}</p>
              <p className="text-sm text-foreground/70">
                {lead.name} ·{" "}
                <a href={`mailto:${lead.email}`} className="text-accent hover:underline">
                  {lead.email}
                </a>
                {lead.phone ? ` · ${lead.phone}` : ""}
              </p>
              {lead.teamSize && (
                <p className="text-sm text-foreground/60">Size: {lead.teamSize}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[lead.status]}`}
              >
                {STATUS_LABELS[lead.status]}
              </span>
              <span className="text-xs text-foreground/50">{formatDate(lead.createdAt)}</span>
            </div>
          </div>

          <p className="whitespace-pre-wrap rounded-lg bg-black/[0.03] p-3 text-sm dark:bg-white/[0.03]">
            {lead.message}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`mailto:${lead.email}?subject=${encodeURIComponent(`Kudos Cards — ${lead.organisation}`)}`}
              className="rounded-md border border-black/15 px-2.5 py-1 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
            >
              Reply by email
            </a>
            {NEXT_ACTIONS[lead.status].map((action) => (
              <button
                key={action.to}
                type="button"
                disabled={pendingId === lead.id}
                onClick={() => void setStatus(lead.id, action.to)}
                className="rounded-md border border-black/15 px-2.5 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
