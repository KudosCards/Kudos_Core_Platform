"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { Occasion } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { Modal } from "@/components/modal";
import { OCCASION_STATUS_LABELS, OCCASION_TYPE_LABELS, formatOccasionDate } from "@/lib/occasions";

/** The display name for a calendar occasion — recipient, else its label/type. */
function occasionName(occasion: Occasion): string {
  if (occasion.recipient) return `${occasion.recipient.firstName} ${occasion.recipient.lastName}`;
  return occasion.title ?? OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

/** Yields the ISO yyyy-mm-dd for a date input, from a Date the API returned. */
function dateInputValue(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * The calendar event pop-up — view an occasion (and, for a scheduled event,
 * edit its label/date inline) without leaving the calendar, with a link through
 * to the full recipient record. See docs/adr/0016 + the calendar page.
 */
export function OccasionModal({
  occasion,
  onClose,
  onUpdated,
}: {
  occasion: Occasion;
  onClose: () => void;
  onUpdated: (occasion: Occasion) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only auto-scheduled birthdays are recurring; hand-added events carry a label.
  const canEditTitle = occasion.source !== "recurring_per_recipient";
  const isScheduled = occasion.status === "scheduled";

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const data = new FormData(event.currentTarget);
    const body: { title?: string; occasionDate?: string } = {
      occasionDate: String(data.get("occasionDate") ?? ""),
    };
    if (canEditTitle) body.title = String(data.get("title") ?? "").trim();
    try {
      const updated = await clientApiFetch<Occasion>(`/occasions/${occasion.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onUpdated(updated);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save the change");
    } finally {
      setSaving(false);
    }
  }

  /** The contextual next step for an occasion that isn't inline-editable. */
  const actionLink =
    occasion.status === "pending_approval"
      ? { href: "/approvals", label: "Review & approve →" }
      : occasion.status === "approved"
        ? { href: "/batch-orders", label: "Create an order →" }
        : null;

  return (
    <Modal open onClose={onClose} title={occasionName(occasion)}>
      {editing ? (
        <form onSubmit={(event) => void handleSave(event)} className="flex flex-col gap-4">
          {error && (
            <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
              {error}
            </p>
          )}
          {canEditTitle && (
            <label className="flex flex-col gap-1 text-sm text-muted">
              Label
              <input
                name="title"
                defaultValue={occasion.title ?? ""}
                maxLength={120}
                placeholder="e.g. Graduation"
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm text-muted">
            Date
            <input
              name="occasionDate"
              type="date"
              required
              defaultValue={dateInputValue(occasion.occasionDate)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-foreground/30 focus:outline-none"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="btn-accent disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.03]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <DetailRow
              label="Occasion"
              value={occasion.title ?? OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type}
            />
            <DetailRow label="Date" value={formatOccasionDate(occasion.occasionDate)} />
            {occasion.dispatchDate && (
              <DetailRow label="Dispatch by" value={formatOccasionDate(occasion.dispatchDate)} />
            )}
            <DetailRow
              label="Status"
              value={OCCASION_STATUS_LABELS[occasion.status] ?? occasion.status}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isScheduled && (
              <button type="button" onClick={() => setEditing(true)} className="btn-accent">
                Edit event
              </button>
            )}
            {actionLink && (
              <Link href={actionLink.href} className="btn-accent" onClick={onClose}>
                {actionLink.label}
              </Link>
            )}
            {occasion.recipientId && (
              <Link
                href={`/recipients/${occasion.recipientId}`}
                onClick={onClose}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.03]"
              >
                View full record →
              </Link>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
