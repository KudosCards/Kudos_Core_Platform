"use client";

import { Zap } from "lucide-react";
import type {
  EventWithMembers,
  Recipient,
  RecipientListSummary,
  SavedDesign,
} from "@kudos/shared-types";
import { suggestFirstClass } from "@kudos/shared-types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { Modal } from "@/components/modal";
import { OCCASION_STATUS_LABELS, OCCASION_TYPE_LABELS, formatOccasionDate } from "@/lib/occasions";
import { OCCASION_TYPES } from "./calendar-utils";
import { RecipientPicker, type Paginated } from "../send/recipient-picker";

type PostageClass = "first_class" | "second_class";

const SENT_STATUSES = new Set(["queued", "printed", "posted", "delivered"]);

/** A searchable contact multi-select that owns its own first-page fetch, so the
 * event modal can drop it in without the parent pre-loading recipients. */
function ContactPicker({
  selectedIds,
  onToggle,
}: {
  selectedIds: Set<string>;
  onToggle: (r: Recipient) => void;
}) {
  const [seed, setSeed] = useState<{
    page: Paginated<Recipient>;
    lists: RecipientListSummary[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [page, lists] = await Promise.all([
          clientApiFetch<Paginated<Recipient>>("/recipients?perPage=20"),
          clientApiFetch<RecipientListSummary[]>("/recipient-lists"),
        ]);
        if (active) setSeed({ page, lists });
      } catch (e) {
        if (active) setError(e instanceof ApiError ? e.message : "Could not load contacts");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className="text-sm text-accent">{error}</p>;
  if (!seed) return <p className="text-sm text-muted">Loading contacts…</p>;
  return (
    <RecipientPicker
      initialPage={seed.page}
      lists={seed.lists}
      selectedIds={selectedIds}
      onToggle={onToggle}
    />
  );
}

/**
 * The calendar's shared-event pop-up. In create mode it captures the event's
 * title/type/date/notes and an initial cohort (reusing the bulk-send contact
 * picker); in manage mode it lists members, adds/removes them, edits the event,
 * and sends the whole cohort in one order. See docs/adr/0057-shared-events.md.
 */
export function EventModal({
  eventId,
  createDate,
  onClose,
  onChanged,
}: {
  /** null → create a new event; otherwise manage this one. */
  eventId: string | null;
  /** Prefilled date (yyyy-mm-dd) for a new event. */
  createDate: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const isCreate = eventId === null;
  return (
    <Modal open onClose={onClose} title={isCreate ? "New event" : "Event"}>
      {isCreate ? (
        <CreateEvent createDate={createDate} onClose={onClose} onChanged={onChanged} />
      ) : (
        <ManageEvent eventId={eventId} onClose={onClose} onChanged={onChanged} />
      )}
    </Modal>
  );
}

function CreateEvent({
  createDate,
  onClose,
  onChanged,
}: {
  createDate: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("leaver");
  const [date, setDate] = useState(createDate);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Map<string, Recipient>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(r: Recipient) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(r.id)) next.delete(r.id);
      else next.set(r.id, r);
      return next;
    });
  }

  async function submit() {
    if (!title.trim()) return setError("Give the event a title");
    if (selected.size === 0) return setError("Attach at least one contact");
    setError(null);
    setSaving(true);
    try {
      await clientApiFetch<EventWithMembers>("/events", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          type,
          eventDate: date,
          notes: notes.trim() || undefined,
          recipientIds: [...selected.keys()],
        }),
      });
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the event");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent">{error}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="e.g. End of Year 2026"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            {OCCASION_TYPES.map((t) => (
              <option key={t} value={t}>
                {OCCASION_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
          Notes (optional)
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            placeholder="Just for you — not printed"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Contacts{selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </span>
        <ContactPicker selectedIds={new Set(selected.keys())} onToggle={toggle} />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="btn-accent disabled:opacity-60"
        >
          {saving ? "Creating…" : `Create event${selected.size ? ` · ${selected.size}` : ""}`}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.03]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ManageEvent({
  eventId,
  onClose,
  onChanged,
}: {
  eventId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [event, setEvent] = useState<EventWithMembers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await clientApiFetch<EventWithMembers>(`/events/${eventId}`);
      setEvent(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the event");
    }
  }, [eventId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await clientApiFetch<EventWithMembers>(`/events/${eventId}`);
        if (active) setEvent(data);
      } catch (e) {
        if (active) setError(e instanceof ApiError ? e.message : "Could not load the event");
      }
    })();
    return () => {
      active = false;
    };
  }, [eventId]);

  async function addMembers() {
    if (toAdd.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await clientApiFetch<EventWithMembers>(`/events/${eventId}/members`, {
        method: "POST",
        body: JSON.stringify({ recipientIds: [...toAdd] }),
      });
      setEvent(updated);
      setToAdd(new Set());
      setAdding(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add contacts");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(recipientId: string) {
    setBusy(true);
    setError(null);
    try {
      await clientApiFetch(`/events/${eventId}/members/${recipientId}`, { method: "DELETE" });
      await reload();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove that contact");
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvent() {
    if (!confirm("Delete this event and all its unsent cards?")) return;
    setBusy(true);
    setError(null);
    try {
      await clientApiFetch(`/events/${eventId}`, { method: "DELETE" });
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the event");
      setBusy(false);
    }
  }

  if (error && !event) return <p className="text-sm text-accent">{error}</p>;
  if (!event) return <p className="text-sm text-muted">Loading…</p>;

  const unsent = event.members.filter((m) => !SENT_STATUSES.has(m.status));

  if (sending) {
    return (
      <SendCohort
        event={event}
        unsentCount={unsent.length}
        onBack={() => setSending(false)}
        onError={setError}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <div className="flex flex-col gap-0.5">
        <h3 className="text-lg font-semibold">{event.title}</h3>
        <p className="text-sm text-muted">
          {OCCASION_TYPE_LABELS[event.type] ?? event.type} · {formatOccasionDate(event.eventDate)} ·{" "}
          {event.memberCount} contact{event.memberCount === 1 ? "" : "s"}
          {event.sentCount > 0 ? ` · ${event.sentCount} sent` : ""}
        </p>
        {event.notes && <p className="text-sm text-muted">{event.notes}</p>}
      </div>

      {adding ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <span className="text-sm font-medium">Add contacts</span>
          <ContactPicker
            selectedIds={toAdd}
            onToggle={(r) =>
              setToAdd((s) => {
                const next = new Set(s);
                if (next.has(r.id)) next.delete(r.id);
                else next.add(r.id);
                return next;
              })
            }
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void addMembers()}
              disabled={busy || toAdd.size === 0}
              className="btn-accent disabled:opacity-60"
            >
              Add {toAdd.size || ""}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setToAdd(new Set());
              }}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.03]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {event.members.map((m) => {
            const sent = SENT_STATUSES.has(m.status);
            return (
              <div key={m.occasionId} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.firstName} {m.lastName}
                  </p>
                  <p className="text-xs text-muted">
                    {OCCASION_STATUS_LABELS[m.status] ?? m.status}
                    {m.order && (
                      <>
                        {" · "}
                        <Link
                          href={`/orders/${m.order.id}`}
                          onClick={onClose}
                          className="text-accent hover:underline"
                        >
                          ORD-{m.order.orderNumber}
                        </Link>
                      </>
                    )}
                    {m.addressVerificationRequired && " · ⚠️ address returned"}
                  </p>
                </div>
                {!sent && (
                  <button
                    type="button"
                    onClick={() => void removeMember(m.recipientId)}
                    disabled={busy}
                    className="shrink-0 text-xs text-muted hover:text-accent"
                    title="Remove from event"
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!adding && (
        <div className="flex flex-wrap items-center gap-2">
          {unsent.length > 0 && (
            <button type="button" onClick={() => setSending(true)} className="btn-accent">
              Send to {unsent.length} contact{unsent.length === 1 ? "" : "s"} →
            </button>
          )}
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.03]"
          >
            Add contacts
          </button>
          <button
            type="button"
            onClick={() => void deleteEvent()}
            disabled={busy || event.sentCount > 0}
            title={event.sentCount > 0 ? "Some cards are already sent" : "Delete event"}
            className="ml-auto text-sm text-muted hover:text-accent disabled:opacity-40"
          >
            Delete event
          </button>
        </div>
      )}
    </div>
  );
}

/** The cohort send step: pick one design + postage, then create + pay one order
 * for every unsent member. Reuses the batch-order checkout redirect. */
function SendCohort({
  event,
  unsentCount,
  onBack,
  onError,
}: {
  event: EventWithMembers;
  unsentCount: number;
  onBack: () => void;
  onError: (message: string) => void;
}) {
  const [designs, setDesigns] = useState<SavedDesign[] | null>(null);
  const [designId, setDesignId] = useState("");
  const [postage, setPostage] = useState<PostageClass>("second_class");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await clientApiFetch<SavedDesign[]>("/saved-designs");
        setDesigns(list);
        if (list[0]) setDesignId(list[0].id);
      } catch (e) {
        setLocalError(e instanceof ApiError ? e.message : "Could not load your designs");
      }
    })();
  }, []);

  const nudge = suggestFirstClass(new Date(event.eventDate));

  async function send() {
    if (!designId) return setLocalError("Choose a design");
    setLocalError(null);
    setSubmitting(true);
    try {
      const order = await clientApiFetch<{ id: string }>(`/events/${event.id}/order`, {
        method: "POST",
        body: JSON.stringify({ savedDesignId: designId, postageClass: postage }),
      });
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>(
        `/batch-orders/${order.id}/checkout`,
        { method: "POST" },
      );
      window.location.assign(checkoutUrl);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Could not start checkout";
      setLocalError(message);
      onError(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {localError && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
          {localError}
        </p>
      )}
      <p className="text-sm text-muted">
        One card to {unsentCount} contact{unsentCount === 1 ? "" : "s"} on {event.title}. Each is
        addressed from the contact&apos;s own record.
      </p>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Design
        {designs === null ? (
          <span className="text-sm">Loading designs…</span>
        ) : designs.length === 0 ? (
          <span className="text-sm">
            No saved designs yet —{" "}
            <Link href="/designs" className="text-accent hover:underline">
              create one
            </Link>
            .
          </span>
        ) : (
          <select
            value={designId}
            onChange={(e) => setDesignId(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            {designs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm text-muted">
        Postage
        <select
          value={postage}
          onChange={(e) => setPostage(e.target.value as PostageClass)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="second_class">Second class (+£0.91/card)</option>
          <option value="first_class">First class (+£1.80/card)</option>
        </select>
      </label>

      {nudge.suggested && postage !== "first_class" && (
        <button
          type="button"
          onClick={() => setPostage("first_class")}
          title={nudge.reason}
          className="inline-flex items-center gap-1 self-start rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200"
        >
          <Zap className="h-3.5 w-3.5" aria-hidden /> {nudge.reason} Use First Class
        </button>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void send()}
          disabled={submitting || !designId}
          className="btn-accent disabled:opacity-60"
        >
          {submitting ? "Starting checkout…" : `Pay for ${unsentCount} card${unsentCount === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.03]"
        >
          Back
        </button>
      </div>
    </div>
  );
}
