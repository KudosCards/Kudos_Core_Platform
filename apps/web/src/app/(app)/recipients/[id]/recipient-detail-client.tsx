"use client";

import type { Occasion, Recipient } from "@kudos/shared-types";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { OCCASION_TYPE_LABELS, formatOccasionDate } from "@/lib/occasions";

/** Types a subscriber can add by hand — birthdays come from the DOB, not here. */
const EVENT_TYPES = ["achievement", "leaver", "staff_recognition", "seasonal", "bespoke_campaign"] as const;

/** How far along the card pipeline each status is — drives the badge colour. */
const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-foreground/[0.06] text-muted",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  queued: "bg-sky-100 text-sky-800",
  printed: "bg-sky-100 text-sky-800",
  posted: "bg-sky-100 text-sky-800",
  delivered: "bg-emerald-100 text-emerald-800",
  skipped: "bg-foreground/[0.06] text-muted",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  queued: "In fulfilment",
  printed: "Printed",
  posted: "Posted",
  delivered: "Delivered",
  skipped: "Skipped",
};

function eventKind(occasion: Occasion): string {
  return occasion.title ?? OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type;
}

export function RecipientDetailClient({
  recipient,
  initialEvents,
}: {
  recipient: Recipient;
  initialEvents: Occasion[];
}) {
  const [events, setEvents] = useState<Occasion[]>(initialEvents);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  function sortEvents(list: Occasion[]): Occasion[] {
    return [...list].sort(
      (a, b) => new Date(a.occasionDate).getTime() - new Date(b.occasionDate).getTime(),
    );
  }

  async function handleAddEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const type = String(data.get("type"));
    const title = String(data.get("title") || "").trim();
    const occasionDate = String(data.get("occasionDate") || "");
    if (!occasionDate) {
      setError("Choose a date for the event");
      return;
    }
    setAdding(true);
    try {
      const created = await clientApiFetch<Occasion>("/occasions/events", {
        method: "POST",
        body: JSON.stringify({
          recipientId: recipient.id,
          type,
          ...(title && { title }),
          occasionDate,
        }),
      });
      setEvents((current) => sortEvents([...current, created]));
      form.reset();
    } catch (addError) {
      setError(addError instanceof ApiError ? addError.message : "Could not add the event");
    } finally {
      setAdding(false);
    }
  }

  async function prepareEvent(id: string) {
    setError(null);
    setPendingId(id);
    try {
      const updated = await clientApiFetch<Occasion>(`/occasions/${id}/prepare`, { method: "POST" });
      setEvents((current) => current.map((e) => (e.id === id ? updated : e)));
    } catch (prepareError) {
      setError(prepareError instanceof ApiError ? prepareError.message : "Could not prepare a card");
    } finally {
      setPendingId(null);
    }
  }

  async function removeEvent(id: string) {
    setError(null);
    setPendingId(id);
    try {
      await clientApiFetch(`/occasions/${id}`, { method: "DELETE" });
      setEvents((current) => current.filter((e) => e.id !== id));
    } catch (removeError) {
      setError(removeError instanceof ApiError ? removeError.message : "Could not remove the event");
    } finally {
      setPendingId(null);
    }
  }

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/recipients" className="text-sm text-muted hover:text-foreground">
          ← Recipients
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          {recipient.firstName} {recipient.lastName}
        </h1>
        <p className="text-muted">
          {recipient.dateOfBirth
            ? `Born ${formatOccasionDate(recipient.dateOfBirth)}`
            : "No date of birth on file"}
          {recipient.addressPostcode ? ` · ${recipient.addressPostcode}` : ""}
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <section className="card flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Events</h2>
          <p className="text-sm text-muted">
            Every date worth a card. Birthdays are added automatically from the date of birth; add
            graduations, the end of exams, or anything else here.
          </p>
        </div>

        {events.length === 0 ? (
          <p className="text-sm text-muted">No events yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {events.map((occasion) => (
              <li
                key={occasion.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{eventKind(occasion)}</span>
                  <span className="text-sm text-muted">{formatOccasionDate(occasion.occasionDate)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLES[occasion.status] ?? "bg-foreground/[0.06] text-muted"
                    }`}
                  >
                    {STATUS_LABELS[occasion.status] ?? occasion.status}
                  </span>
                  {occasion.status === "scheduled" && (
                    <>
                      <button
                        type="button"
                        disabled={pendingId === occasion.id}
                        onClick={() => void prepareEvent(occasion.id)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-foreground/[0.03] disabled:opacity-40"
                      >
                        Prepare card
                      </button>
                      <button
                        type="button"
                        disabled={pendingId === occasion.id}
                        onClick={() => void removeEvent(occasion.id)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs text-accent hover:bg-accent-soft disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </>
                  )}
                  {occasion.status === "pending_approval" && (
                    <Link
                      href="/approvals"
                      className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-foreground/[0.03]"
                    >
                      Review
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(event) => void handleAddEvent(event)}
          className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-muted">Type</span>
            <select name="type" className={inputClass} defaultValue="achievement">
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {OCCASION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-[2] flex-col gap-1 text-sm">
            <span className="text-muted">Name (optional)</span>
            <input name="title" placeholder="e.g. Graduation" className={inputClass} />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-muted">Date</span>
            <input type="date" name="occasionDate" required className={inputClass} />
          </label>
          <button type="submit" disabled={adding} className="btn-accent">
            {adding ? "Adding…" : "Add event"}
          </button>
        </form>
      </section>
    </div>
  );
}
