"use client";

import { Cake } from "lucide-react";
import type {
  KeyDateType,
  Occasion,
  Recipient,
  RecipientKeyDate,
  ReturnCase,
} from "@kudos/shared-types";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import {
  OCCASION_STATUS_HELP,
  OCCASION_STATUS_LABELS,
  OCCASION_STATUS_STYLES,
  OCCASION_TYPE_LABELS,
  formatOccasionDate,
  occasionKind,
  occasionName,
} from "@/lib/occasions";
import { ReturnRecoveryPanel } from "./return-recovery-panel";

/** Types a subscriber can add by hand — birthdays come from the DOB, not here. */
const EVENT_TYPES = [
  "achievement",
  "leaver",
  "staff_recognition",
  "seasonal",
  "bespoke_campaign",
] as const;

/** How far along the card pipeline each status is — drives the badge colour. */

/** A Date|string to the yyyy-mm-dd a <input type="date"> expects. */
function toDateInput(value: string | Date | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

/** Whole days from today to `value` (negative = in the past), day-boundary aligned. */
function daysUntil(value: string | Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(value);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** How many past dates the timeline shows before folding the rest away. Enough
 * to see the recent history at a glance without the section becoming an archive.
 */
const PAST_EVENTS_SHOWN = 4;

/** A friendly countdown for an upcoming date — "Today", "Tomorrow", "In 3 weeks". */
function countdownLabel(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

/** The recurring key-date types a user can set, in display order. */
const KEY_DATE_TYPES: { type: KeyDateType; label: string }[] = [
  { type: "renewal", label: "Renewal" },
  { type: "anniversary", label: "Anniversary" },
];

export function RecipientDetailClient({
  recipient: initialRecipient,
  initialEvents,
  initialReturnCases,
  initialKeyDates,
}: {
  recipient: Recipient;
  initialEvents: Occasion[];
  initialReturnCases: ReturnCase[];
  initialKeyDates: RecipientKeyDate[];
}) {
  const [recipient, setRecipient] = useState<Recipient>(initialRecipient);
  const [events, setEvents] = useState<Occasion[]>(initialEvents);
  const [showAllPast, setShowAllPast] = useState(false);
  const [keyDates, setKeyDates] = useState<RecipientKeyDate[]>(initialKeyDates);
  const [pendingKeyDate, setPendingKeyDate] = useState<KeyDateType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Details editing. `openedForAddress` is set when the editor is opened from the
  // "Add postal address" CTA, so the address line is focused straight away.
  const [editingDetails, setEditingDetails] = useState(false);
  const [openedForAddress, setOpenedForAddress] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [archiving, setArchiving] = useState(false);

  function openEditor(forAddress: boolean) {
    setOpenedForAddress(forAddress);
    setEditingDetails(true);
  }
  function closeEditor() {
    setEditingDetails(false);
    setOpenedForAddress(false);
  }

  // Event editing (one row at a time) + the collapsible "add an event" form.
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [showAddEvent, setShowAddEvent] = useState(false);

  // Custom fields — arbitrary key→value pairs that become {key} merge tokens on
  // a card. Edited as an ordered list of rows, saved as a whole map. Each row
  // carries a stable `id` so React keys by identity, not position — otherwise
  // removing a middle row would leave the inputs below misaligned (a row's
  // value/focus would jump to its neighbour).
  const [fieldRows, setFieldRows] = useState<{ id: string; key: string; value: string }[]>(() =>
    Object.entries(recipient.customFields ?? {}).map(([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value,
    })),
  );
  const [savingFields, setSavingFields] = useState(false);

  const isArchived = recipient.status === "archived";
  const hasPostalAddress = Boolean(
    recipient.addressLine1?.trim() &&
    recipient.addressCity?.trim() &&
    recipient.addressPostcode?.trim(),
  );

  function sortEvents(list: Occasion[]): Occasion[] {
    return [...list].sort(
      (a, b) => new Date(a.occasionDate).getTime() - new Date(b.occasionDate).getTime(),
    );
  }

  // Split events into what's coming up (soonest first) and what's been and gone
  // (most recent first), so the list leads with the dates that still need action.
  const sortedEvents = sortEvents(events);
  const upcomingEvents = sortedEvents.filter((e) => daysUntil(e.occasionDate) >= 0);
  const pastEvents = sortedEvents.filter((e) => daysUntil(e.occasionDate) < 0).reverse();
  // A contact accumulates every date they have ever had — a birthday a year,
  // plus every one-off — so after a few years the history buries the one thing
  // this section is for, which is what is coming up. The recent past is shown
  // and the rest is a click away.
  const shownPastEvents = showAllPast ? pastEvents : pastEvents.slice(0, PAST_EVENTS_SHOWN);

  async function handleSaveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const str = (key: string) => String(data.get(key) || "").trim();
    const body: Record<string, unknown> = {
      firstName: str("firstName"),
      lastName: str("lastName"),
    };
    // PATCH is a merge, so only send these when set (blank = leave unchanged).
    for (const key of ["dateOfBirth", "email"]) {
      const value = str(key);
      if (value) body[key] = value;
    }
    // Address is always sent so it can be *cleared*, not just added — a blank
    // field nulls the column (the API accepts null and flags the contact as
    // needing an address). See docs/adr/0067.
    for (const key of ["addressLine1", "addressLine2", "addressCity", "addressPostcode"]) {
      const value = str(key);
      body[key] = value === "" ? null : value;
    }
    setSavingDetails(true);
    try {
      const updated = await clientApiFetch<Recipient>(`/recipients/${recipient.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setRecipient(updated);
      closeEditor();
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
      setError(
        archiveError instanceof ApiError ? archiveError.message : "Could not update the contact",
      );
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
      setFieldRows(
        Object.entries(updated.customFields ?? {}).map(([key, value]) => ({
          id: crypto.randomUUID(),
          key,
          value,
        })),
      );
    } catch (saveError) {
      setError(
        saveError instanceof ApiError ? saveError.message : "Could not save the card fields",
      );
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
      setShowAddEvent(false);
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
      const updated = await clientApiFetch<Occasion>(`/occasions/${id}/prepare`, {
        method: "POST",
      });
      setEvents((current) => current.map((e) => (e.id === id ? updated : e)));
    } catch (prepareError) {
      setError(
        prepareError instanceof ApiError ? prepareError.message : "Could not prepare a card",
      );
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
      setError(
        removeError instanceof ApiError ? removeError.message : "Could not remove the event",
      );
    } finally {
      setPendingId(null);
    }
  }

  /** Reload the recipient's occasions after a key date changes, so the new/removed
   * renewal/anniversary shows up in the Events list. Best-effort. */
  async function refreshEvents() {
    try {
      const result = await clientApiFetch<{ items: Occasion[] }>(
        `/occasions?recipientId=${recipient.id}&perPage=100`,
      );
      setEvents(sortEvents(result.items));
    } catch {
      // The key date saved regardless; a stale Events list self-heals on reload.
    }
  }

  async function saveKeyDate(type: KeyDateType, date: string) {
    if (!date) return;
    setError(null);
    setPendingKeyDate(type);
    try {
      const updated = await clientApiFetch<RecipientKeyDate>(
        `/recipients/${recipient.id}/key-dates/${type}`,
        { method: "PUT", body: JSON.stringify({ date }) },
      );
      setKeyDates((current) => [...current.filter((k) => k.type !== type), updated]);
      await refreshEvents();
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save the key date");
    } finally {
      setPendingKeyDate(null);
    }
  }

  async function removeKeyDate(type: KeyDateType) {
    setError(null);
    setPendingKeyDate(type);
    try {
      await clientApiFetch(`/recipients/${recipient.id}/key-dates/${type}`, { method: "DELETE" });
      setKeyDates((current) => current.filter((k) => k.type !== type));
      await refreshEvents();
    } catch (removeError) {
      setError(
        removeError instanceof ApiError ? removeError.message : "Could not remove the key date",
      );
    } finally {
      setPendingKeyDate(null);
    }
  }

  /** One event row — the inline edit form when it's the row being edited, else the read row. */
  function renderEvent(occasion: Occasion) {
    if (editingEventId === occasion.id) {
      return (
        <li key={occasion.id} className="py-3">
          <form
            onSubmit={(event) => void handleSaveEvent(event, occasion.id)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <label className="flex flex-[2] flex-col gap-1 text-sm">
              <span className="text-muted">Name</span>
              <input
                name="title"
                defaultValue={occasion.title ?? ""}
                placeholder={occasionName(occasion)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted">Date</span>
              <input
                type="date"
                name="occasionDate"
                defaultValue={toDateInput(occasion.occasionDate)}
                required
                className={inputClass}
              />
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
      );
    }

    const days = daysUntil(occasion.occasionDate);
    return (
      <li
        key={occasion.id}
        className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-medium">
            {occasion.type === "birthday" && <Cake className="h-4 w-4" aria-hidden />}
            {occasionName(occasion)}
            {/* The kind, beside the name the customer gave it. A leaver's date
                named "96" used to render as a bare "96" with nothing to say
                what it was. */}
            {occasionKind(occasion) && (
              <span className="text-sm font-normal text-muted">· {occasionKind(occasion)}</span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {formatOccasionDate(occasion.occasionDate)}
            {days >= 0 && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                {countdownLabel(days)}
              </span>
            )}
            {OCCASION_STATUS_HELP[occasion.status] && (
              <span className="text-xs">{OCCASION_STATUS_HELP[occasion.status]}</span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              OCCASION_STATUS_STYLES[occasion.status] ?? "bg-foreground/[0.06] text-muted"
            }`}
          >
            {OCCASION_STATUS_LABELS[occasion.status] ?? occasion.status}
          </span>
          {occasion.order && (
            <Link
              href={`/orders/${occasion.order.id}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-accent hover:bg-accent-soft"
            >
              ORD-{occasion.order.orderNumber} →
            </Link>
          )}
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
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/recipients" className="text-sm text-muted hover:text-foreground">
            ← Contacts
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
            <button
              type="button"
              onClick={() => openEditor(false)}
              className="btn-secondary text-sm"
            >
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

      {error && <p className="notice notice-danger">{error}</p>}

      <ReturnRecoveryPanel
        recipient={recipient}
        initialCases={initialReturnCases}
        onRecipientChanged={(patch) => setRecipient((current) => ({ ...current, ...patch }))}
      />

      {!editingDetails && (
        <section className="card flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Contact details</h2>
            <button
              type="button"
              onClick={() => openEditor(false)}
              className="text-sm text-accent hover:underline"
            >
              Edit
            </button>
          </div>

          {/* Address leads — it's the field that has to be present before a card can
              be posted, so it gets the most visual weight and a prominent CTA when
              it's missing. */}
          {hasPostalAddress ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-foreground/[0.02] p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Postal address
                </span>
                <address className="not-italic text-sm leading-relaxed">
                  {[
                    recipient.addressLine1,
                    recipient.addressLine2,
                    recipient.addressCity,
                    recipient.addressPostcode,
                  ]
                    .filter((line) => line?.trim())
                    .map((line, index) => (
                      <span key={index} className="block">
                        {line}
                      </span>
                    ))}
                </address>
              </div>
              <button
                type="button"
                onClick={() => openEditor(true)}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-foreground/[0.03]"
              >
                Edit address
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-soft p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">No postal address yet</span>
                <span className="text-sm text-warning">
                  Add one so {recipient.firstName} can be posted a card.
                </span>
              </div>
              <button
                type="button"
                onClick={() => openEditor(true)}
                className="btn-accent shrink-0 self-start text-sm sm:self-auto"
              >
                Add postal address
              </button>
            </div>
          )}

          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">
                Date of birth
              </dt>
              <dd className="text-sm">
                {recipient.dateOfBirth ? (
                  formatOccasionDate(recipient.dateOfBirth)
                ) : (
                  <span className="text-muted">Not on file</span>
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">Email</dt>
              <dd className="text-sm">
                {recipient.email ? (
                  recipient.email
                ) : (
                  <span className="text-muted">Not on file</span>
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {editingDetails && (
        <form
          onSubmit={(event) => void handleSaveDetails(event)}
          className="card flex flex-col gap-4 p-6"
        >
          <h2 className="text-lg font-semibold">
            {openedForAddress && !hasPostalAddress ? "Add postal address" : "Edit details"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">First name</span>
              <input
                name="firstName"
                defaultValue={recipient.firstName}
                required
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Last name</span>
              <input
                name="lastName"
                defaultValue={recipient.lastName}
                required
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Date of birth</span>
              <input
                type="date"
                name="dateOfBirth"
                defaultValue={toDateInput(recipient.dateOfBirth)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Email</span>
              <input
                type="email"
                name="email"
                defaultValue={recipient.email ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Address line 1</span>
              <input
                name="addressLine1"
                defaultValue={recipient.addressLine1 ?? ""}
                autoFocus={openedForAddress}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Address line 2</span>
              <input
                name="addressLine2"
                defaultValue={recipient.addressLine2 ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">City</span>
              <input
                name="addressCity"
                defaultValue={recipient.addressCity ?? ""}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Postcode</span>
              <input
                name="addressPostcode"
                defaultValue={recipient.addressPostcode ?? ""}
                className={inputClass}
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={savingDetails} className="btn-accent">
              {savingDetails ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={closeEditor}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-foreground/[0.03]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="card flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Key dates</h2>
          <p className="text-sm text-muted">
            Recurring renewal and anniversary dates. We’ll schedule a card for each one every year —
            just like birthdays.
          </p>
        </div>
        <div className="flex flex-col divide-y divide-border">
          {KEY_DATE_TYPES.map(({ type, label }) => {
            const existing = keyDates.find((k) => k.type === type);
            return (
              <form
                key={`${type}-${existing?.id ?? "none"}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const date = String(new FormData(event.currentTarget).get("date") ?? "");
                  void saveKeyDate(type, date);
                }}
                className="flex flex-wrap items-center gap-2 py-3"
              >
                <span className="w-28 shrink-0 font-medium">{label}</span>
                <input
                  type="date"
                  name="date"
                  aria-label={`${label} date`}
                  defaultValue={existing ? toDateInput(existing.date) : ""}
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={pendingKeyDate === type}
                  className="btn-accent text-sm"
                >
                  {pendingKeyDate === type ? "Saving…" : existing ? "Update" : "Set"}
                </button>
                {existing && (
                  <button
                    type="button"
                    onClick={() => void removeKeyDate(type)}
                    disabled={pendingKeyDate === type}
                    className="rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/[0.03] disabled:opacity-40"
                  >
                    Remove
                  </button>
                )}
              </form>
            );
          })}
        </div>
      </section>

      <section className="card flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">
              Events
              {events.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted">{events.length}</span>
              )}
            </h2>
            <p className="text-sm text-muted">
              Every date worth a card. Birthdays are added automatically from the date of birth; add
              graduations, the end of exams, or anything else here.
            </p>
          </div>
          {!showAddEvent && (
            <button
              type="button"
              onClick={() => setShowAddEvent(true)}
              className="btn-secondary shrink-0 text-sm"
            >
              ＋ Add an event
            </button>
          )}
        </div>

        {showAddEvent && (
          <form
            onSubmit={(event) => void handleAddEvent(event)}
            className="flex flex-col gap-3 rounded-lg border border-border bg-foreground/[0.02] p-4 sm:flex-row sm:items-end"
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
            <div className="flex items-center gap-2">
              <button type="submit" disabled={adding} className="btn-accent">
                {adding ? "Adding…" : "Add event"}
              </button>
              <button
                type="button"
                onClick={() => setShowAddEvent(false)}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/[0.03]"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm font-medium">No events yet</p>
            <p className="mt-1 text-sm text-muted">
              Add a graduation, work anniversary, or any date worth a card.
            </p>
            {!showAddEvent && (
              <button
                type="button"
                onClick={() => setShowAddEvent(true)}
                className="btn-accent mt-3 text-sm"
              >
                Add the first event
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {upcomingEvents.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Upcoming
                </h3>
                <ul className="flex flex-col divide-y divide-border">
                  {upcomingEvents.map(renderEvent)}
                </ul>
              </div>
            )}
            {pastEvents.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Past</h3>
                <ul className="flex flex-col divide-y divide-border opacity-70">
                  {shownPastEvents.map(renderEvent)}
                </ul>
                {pastEvents.length > PAST_EVENTS_SHOWN && (
                  <button
                    type="button"
                    onClick={() => setShowAllPast((current) => !current)}
                    className="self-start pt-1 text-sm font-medium text-accent hover:underline"
                  >
                    {showAllPast ? "Show fewer" : `Show all ${pastEvents.length} past dates`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Card fields</h2>
          <p className="text-sm text-muted">
            Extra details you can drop into a card design as a merge token. A field named{" "}
            <code className="rounded bg-foreground/10 px-1">teacher</code> becomes{" "}
            <code className="rounded bg-foreground/10 px-1">{"{teacher}"}</code>, personalised per
            contact when the card is sent.
          </p>
        </div>

        {fieldRows.length === 0 ? (
          <p className="text-sm text-muted">No custom fields yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {fieldRows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  aria-label="Field name"
                  value={row.key}
                  placeholder="Field name (e.g. teacher)"
                  onChange={(e) =>
                    setFieldRows((rows) =>
                      rows.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)),
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
                      rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)),
                    )
                  }
                  className={`${inputClass} flex-[2]`}
                />
                <button
                  type="button"
                  onClick={() => setFieldRows((rows) => rows.filter((r) => r.id !== row.id))}
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
            onClick={() =>
              setFieldRows((rows) => [...rows, { id: crypto.randomUUID(), key: "", value: "" }])
            }
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
