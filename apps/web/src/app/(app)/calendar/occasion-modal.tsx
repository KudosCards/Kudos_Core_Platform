"use client";

import { Cake, Pin } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { CalendarOccasion, Occasion } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { Modal } from "@/components/modal";
import {
  OCCASION_CARD_IN_FLIGHT,
  OCCASION_STATUS_LABELS,
  OCCASION_TYPE_LABELS,
  formatOccasionDate,
} from "@/lib/occasions";

/** The display name for a calendar occasion — recipient, else its label/type. */
function occasionName(occasion: CalendarOccasion): string {
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
  occasion: CalendarOccasion;
  onClose: () => void;
  onUpdated: (occasion: CalendarOccasion) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resetDispatch() {
    setError(null);
    setSaving(true);
    try {
      const updated = await clientApiFetch<Occasion>(`/occasions/${occasion.id}/dispatch-date`, {
        method: "PATCH",
        body: JSON.stringify({ dispatchDate: null }),
      });
      onUpdated(updated);
    } catch (resetError) {
      setError(resetError instanceof ApiError ? resetError.message : "Could not reset the date");
    } finally {
      setSaving(false);
    }
  }

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
      : null;

  // The quickest path to a posted card: the one-page send flow, pre-seeded with
  // this contact. Offered whenever a card isn't already on its way, so the
  // subscriber can send straight from the calendar instead of hunting for it.
  const canSendCard =
    Boolean(occasion.recipientId) && !OCCASION_CARD_IN_FLIGHT.has(occasion.status);

  return (
    <Modal open onClose={onClose} title={occasionName(occasion)}>
      {editing ? (
        <form onSubmit={(event) => void handleSave(event)} className="flex flex-col gap-4">
          {error && <p className="notice notice-danger">{error}</p>}
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
            <button type="submit" disabled={saving} className="btn-accent disabled:opacity-60">
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
              <DetailRow
                label="Dispatch by"
                value={
                  <span className="inline-flex items-center gap-2">
                    {formatOccasionDate(occasion.dispatchDate)}
                    {occasion.dispatchDateOverridden && (
                      <span title="Manually placed">
                        <Pin className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    )}
                  </span>
                }
              />
            )}
            <DetailRow
              label="Card status"
              value={OCCASION_STATUS_LABELS[occasion.status] ?? occasion.status}
            />
            {occasion.order && (
              <DetailRow
                label="Order"
                value={
                  <Link
                    href={`/orders/${occasion.order.id}`}
                    onClick={onClose}
                    className="text-accent hover:underline"
                  >
                    ORD-{occasion.order.orderNumber} →
                  </Link>
                }
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canSendCard && (
              <Link
                href={`/send?recipients=${occasion.recipientId}`}
                onClick={onClose}
                className="btn-accent inline-flex items-center gap-1.5"
              >
                <Cake className="h-4 w-4" aria-hidden /> Send a card
              </Link>
            )}
            {isScheduled && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={canSendCard ? "btn-secondary" : "btn-accent"}
              >
                Edit event
              </button>
            )}
            {occasion.dispatchDateOverridden && (
              <button
                type="button"
                onClick={() => void resetDispatch()}
                disabled={saving}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.03] disabled:opacity-40"
              >
                Reset dispatch date
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
