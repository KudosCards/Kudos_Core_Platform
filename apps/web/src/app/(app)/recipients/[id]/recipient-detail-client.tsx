"use client";

import type { Occasion, Recipient, ReturnCase } from "@kudos/shared-types";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { OCCASION_TYPE_LABELS, formatOccasionDate } from "@/lib/occasions";
import { ReturnRecoveryPanel } from "./return-recovery-panel";

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

/** A Date|string to the yyyy-mm-dd a <input type="date"> expects. */
function toDateInput(value: string | Date | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

export function RecipientDetailClient({
  recipient: initialRecipient,
  initialEvents,
  initialReturnCases,
}: {
  recipient: Recipient;
  initialEvents: Occasion[];
  initialReturnCases: ReturnCase[];
}) {
  const [recipient, setRecipient] = useState<Recipient>(initialRecipient);
  const [events, setEvents] = useState<Occasion[]>(initialEvents);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Details editing.
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Event editing (one row at a time).
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Custom fields — arbitrary key→value pairs that become {key} merge tokens on
  // a card. Edited as an ordered list of rows, saved as a whole map.
  const [fieldRows, setFieldRows] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(recipient.customFields ?? {}).map(([key, value]) => ({ key, value })),
  );
  const [savingFields, setSavingFields] = useState(false);

  const isArchived = recipient.status === "archived";

  function sortEvents(list: Occasion[]): Occasion[] {
    return [...list].sort(
      (a, b) => new Date(a.occasionDate).getTime() - new Date(b.occasionDate).getTime(),
    );
  }

  async function handleSaveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const str = (key: string) => String(data.get(key) || "").trim();
    // PATCH is a merge and the API rejects empty optional strings, so only send
    // fields that have a value. (Clearing a field isn't offered here.)
    const body: Record<string, unknown> = {
      firstName: str("firstName"),
      lastName: str("lastName"),
    };
    for (const key of ["dateOfBirth", "email", "addressLine1", "addressLine2", "addressCity", "addressPostcode"]) {
      const value = str(key);
      if (value) body[key] = value;
    }
    setSavingDetails(true);
    try {
      const updated = await clientApiFetch<Recipient>(`/recipients/${recipient.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setRecipient(updated);
      setEditingDetails(false);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save the details");
    } finally {
      setSavingDetails(false);
    }
  }

  async function toggleArchive() {
    setError(null);
    setArchiving(true);
    try {
      const updated = isArchived
        ? await clientApiFetch<Recipient>(`/recipients/${recipient.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "active" }),
          })
        : await clientApiFetch<Recipient>(`/recipients/${recipient.id}`, { method: "DELETE" });
      setRecipient(updated);
    } catch (archiveError) {
      setError(archiveError instanceof ApiError ? archiveError.message : "Could not update the recipient");
    } finally {
      setArchiving(false);
    }
  }

  async function handleSaveFields() {
    setError(null);
    // Collapse the rows into a map, dropping blank keys and de-duplicating on the
    // last-wins key (case preserved, as designers reference it verbatim).
    const map: Record<string, string> = {};
    for (const { key, value } of fieldRows) {
      const trimmed = key.trim();
      if (trimmed) map[trimmed] = value;
    }
    setSavingFields(true);
    try {
      const updated = await clientApiFetch<Recipient>(`/recipients/${recipient.id}`, {
        method: "PATCH",
        body: JSON.stringify({ customFields: map }),
      });
      setRecipient(updated);
      setFieldRows(Object.entries(updated.customFields ?? {}).map(([key, value]) => ({ key, value })));
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save the card fields");
    } finally {
      setSavingFields(false);
    }
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

  async function handleSaveEvent(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") || "").trim();
    const occasionDate = String(data.get("occasionDate") || "");
    setPendingId(id);
    try {
      const updated = await clientApiFetch<Occasion>(`/occasions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, ...(occasionDate && { occasionDate }) }),
      });
      setEvents((current) => sortEvents(current.map((e) => (e.id === id ? updated : e))));
      setEditingEventId(null);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save the event");
    } finally {
      setPendingId(null);
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/recipients" className="text-sm text-muted hover:text-foreground">
            ← Recipients
          </Link>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            {recipient.firstName} {recipient.lastName}
            {isArchived && (
              <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs font-medium text-muted">
                Archived
              </span>
            )}
          </h1>
          <p className="text-muted">
            {recipient.dateOfBirth
              ? `Born ${formatOccasionDate(recipient.dateOfBirth)}`
              : "No date of birth on file"}
            {recipient.addressPostcode ? ` · ${recipient.addressPostcode}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!editingDetails && (
            <button type="button" onClick={() => setEditingDetails(true)} className="btn-secondary text-sm">
              Edit details
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleArchive()}
            disabled={archiving}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/[0.03] disabled:opacity-40"
          >
            {archiving ? "…" : isArchived ? "Restore" : "Archive"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <ReturnRecoveryPanel
        recipient={recipient}
        initialCases={initialReturnCases}
        onRecipientChanged={(patch) => setRecipient((current) => ({ ...current, ...patch }))}
      />

      {editingDetails && (
        <form onSubmit={(event) => void handleSaveDetails(event)} className="card flex flex-col gap-4 p-6">
          <h2 className="text-lg font-semibold">Edit details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">First name</span>
              <input name="firstName" defaultValue={recipient.firstName} required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Last name</span>
              <input name="lastName" defaultValue={recipient.lastName} required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Date of birth</span>
              <input type="date" name="dateOfBirth" defaultValue={toDateInput(recipient.dateOfBirth)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Email</span>
              <input type="email" name="email" defaultValue={recipient.email ?? ""} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Address line 1</span>
              <input name="addressLine1" defaultValue={recipient.addressLine1 ?? ""} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Address line 2</span>
              <input name="addressLine2" defaultValue={recipient.addressLine2 ?? ""} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">City</span>
              <input name="addressCity" defaultValue={recipient.addressCity ?? ""} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Postcode</span>
              <input name="addressPostcode" defaultValue={recipient.addressPostcode ?? ""} className={inputClass} />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={savingDetails} className="btn-accent">
              {savingDetails ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => setEditingDetails(false)}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-foreground/[0.03]"
            >
              Cancel
            </button>
          </div>
        </form>
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
            {events.map((occasion) =>
              editingEventId === occasion.id ? (
                <li key={occasion.id} className="py-3">
                  <form
                    onSubmit={(event) => void handleSaveEvent(event, occasion.id)}
                    className="flex flex-col gap-3 sm:flex-row sm:items-end"
                  >
                    <label className="flex flex-[2] flex-col gap-1 text-sm">
                      <span className="text-muted">Name</span>
                      <input name="title" defaultValue={occasion.title ?? ""} placeholder={eventKind(occasion)} className={inputClass} />
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      <span className="text-muted">Date</span>
                      <input type="date" name="occasionDate" defaultValue={toDateInput(occasion.occasionDate)} required className={inputClass} />
                    </label>
                    <div className="flex items-center gap-2">
                      <button type="submit" disabled={pendingId === occasion.id} className="btn-accent">
                        {pendingId === occasion.id ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingEventId(null)}
                        className="rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/[0.03]"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
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
                          onClick={() => setEditingEventId(occasion.id)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-foreground/[0.03] disabled:opacity-40"
                        >
                          Edit
                        </button>
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
              ),
            )}
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

      <section className="card flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Card fields</h2>
          <p className="text-sm text-muted">
            Extra details you can drop into a card design as a merge token. A field named{" "}
            <code className="rounded bg-foreground/10 px-1">teacher</code> becomes{" "}
            <code className="rounded bg-foreground/10 px-1">{"{teacher}"}</code>, personalised per
            recipient when the card is sent.
          </p>
        </div>

        {fieldRows.length === 0 ? (
          <p className="text-sm text-muted">No custom fields yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {fieldRows.map((row, index) => (
              <li key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  aria-label="Field name"
                  value={row.key}
                  placeholder="Field name (e.g. teacher)"
                  onChange={(e) =>
                    setFieldRows((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)),
                    )
                  }
                  className={`${inputClass} flex-1`}
                />
                <input
                  aria-label="Field value"
                  value={row.value}
                  placeholder="Value (e.g. Mrs Patel)"
                  onChange={(e) =>
                    setFieldRows((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)),
                    )
                  }
                  className={`${inputClass} flex-[2]`}
                />
                <button
                  type="button"
                  onClick={() => setFieldRows((rows) => rows.filter((_, i) => i !== index))}
                  className="rounded-md border border-border px-2.5 py-2 text-xs text-accent hover:bg-accent-soft"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setFieldRows((rows) => [...rows, { key: "", value: "" }])}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/[0.03]"
          >
            Add field
          </button>
          <button
            type="button"
            onClick={() => void handleSaveFields()}
            disabled={savingFields}
            className="btn-accent"
          >
            {savingFields ? "Saving…" : "Save fields"}
          </button>
        </div>
      </section>
    </div>
  );
}
