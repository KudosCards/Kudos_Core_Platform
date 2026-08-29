"use client";

import { Pin } from "lucide-react";
import type {
  CalendarOccasion,
  CalendarOccasionsResponse,
  EventSummary,
} from "@kudos/shared-types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { OCCASION_TYPE_LABELS, occasionKind, occasionName } from "@/lib/occasions";
import { Modal } from "@/components/modal";
import { OccasionModal } from "./occasion-modal";
import { EventModal } from "./event-modal";
import {
  addDaysUTC,
  fetchRange,
  listWindowRange,
  monthGridRange,
  occasionDay,
  occasionProgress,
  weekRange,
  ymdUTC,
  OCCASION_SENT_COLOR,
  OCCASION_SKIPPED_COLOR,
  OCCASION_TYPE_COLORS,
  OCCASION_TYPES,
  type CalendarView,
} from "./calendar-utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VIEWS: CalendarView[] = ["month", "week", "list"];

/** Fetch the account's shared events for the visible range, type-filtered to
 * match the occasion view. A plain helper (not a hook) so both the mount effect
 * and the post-mutation refresh can share it. */
async function fetchEventsForRange(
  view: CalendarView,
  anchor: Date,
  typeFilter: string,
): Promise<EventSummary[]> {
  const { start, end } = fetchRange(view, anchor);
  const params = new URLSearchParams({ from: ymdUTC(start), to: ymdUTC(end) });
  const items = await clientApiFetch<EventSummary[]>(`/events?${params.toString()}`);
  return typeFilter === "all" ? items : items.filter((e) => e.type === typeFilter);
}

function occasionLabel(occasion: CalendarOccasion): string {
  if (occasion.recipient) {
    return `${occasion.recipient.firstName} ${occasion.recipient.lastName}`;
  }
  return occasionName(occasion);
}

/** The name and kind together, for the pop-up's detail line — "96 · Leaver"
 * rather than either half on its own. See lib/occasions.ts. */
function occasionDescription(occasion: CalendarOccasion): string {
  const kind = occasionKind(occasion);
  return kind ? `${occasionName(occasion)} · ${kind}` : occasionName(occasion);
}

/** A friendly heading for the list view's month relative to today: "This month",
 * "Next month", or the month + year. `todayKey` is a YYYY-MM-DD string. */
function relativeMonthLabel(anchor: Date, todayKey: string): string {
  const [ty, tm] = todayKey.split("-").map(Number);
  const ay = anchor.getUTCFullYear();
  const am = anchor.getUTCMonth() + 1;
  const monthsAhead = (ay - ty!) * 12 + (am - tm!);
  if (monthsAhead === 0) return "This month";
  if (monthsAhead === 1) return "Next month";
  return anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Whether `relativeMonthLabel` returns a relative phrase ("This/Next month")
 * rather than the month name itself — so the list header knows whether to also
 * spell out the actual month. */
function isRelativeMonthLabel(anchor: Date, todayKey: string): boolean {
  const [ty, tm] = todayKey.split("-").map(Number);
  const monthsAhead = (anchor.getUTCFullYear() - ty!) * 12 + (anchor.getUTCMonth() + 1 - tm!);
  return monthsAhead === 0 || monthsAhead === 1;
}

function periodLabel(view: CalendarView, anchor: Date): string {
  if (view === "week") {
    const { start, end } = weekRange(anchor);
    const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };
    return `${start.toLocaleDateString("en-GB", opts)} – ${end.toLocaleDateString("en-GB", {
      ...opts,
      year: "numeric",
    })}`;
  }
  if (view === "list") {
    // The list spans a forward window of months, so label the span, not a
    // single month (e.g. "Jul – Sep 2026").
    const { start, end } = listWindowRange(anchor);
    return `${start.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })} – ${end.toLocaleDateString(
      "en-GB",
      { month: "short", year: "numeric", timeZone: "UTC" },
    )}`;
  }
  return anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function OccasionPill({
  occasion,
  onOpen,
  draggable = false,
  onDragStart,
}: {
  occasion: CalendarOccasion;
  onOpen: (occasion: CalendarOccasion) => void;
  /** When true, the pill can be dragged to a new dispatch day (grid + dispatch
   * view only, and only for cards not yet on an order). */
  draggable?: boolean;
  onDragStart?: (occasion: CalendarOccasion) => void;
}) {
  const progress = occasionProgress(occasion.status, occasion.order?.status);
  const color =
    progress === "sent"
      ? OCCASION_SENT_COLOR
      : progress === "skipped" || progress === "missed"
        ? OCCASION_SKIPPED_COLOR
        : (OCCASION_TYPE_COLORS[occasion.type] ?? OCCASION_TYPE_COLORS.bespoke_campaign);
  // "Missed" and "Skipped" look the same on the grid — both are over — but they
  // are never called the same thing: one is the customer's decision, the other
  // is a date that went by.
  const stateNote =
    progress === "sent"
      ? " · Sent"
      : progress === "skipped"
        ? " · Skipped"
        : progress === "missed"
          ? " · Missed"
          : "";
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData("text/plain", occasion.id);
              e.dataTransfer.effectAllowed = "move";
              onDragStart?.(occasion);
            }
          : undefined
      }
      onClick={() => onOpen(occasion)}
      className={`flex w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-xs hover:opacity-80 ${color} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      title={
        draggable
          ? `${occasionLabel(occasion)} — drag to change the dispatch day`
          : `${occasionLabel(occasion)} · ${occasionDescription(occasion)}${stateNote}`
      }
    >
      {progress === "sent" && (
        <span aria-hidden className="shrink-0 font-bold">
          ✓
        </span>
      )}
      {occasion.dispatchDateOverridden && draggable && (
        <span className="shrink-0" title="Manually placed">
          <Pin className="h-3 w-3" aria-hidden />
        </span>
      )}
      <span className="truncate">{occasionLabel(occasion)}</span>
    </button>
  );
}

/** A shared event, collapsed to one calendar entry (not N per-contact pills):
 * its title plus a "sent / total" progress, opening the manage pop-up. */
function EventPill({ event, onOpen }: { event: EventSummary; onOpen: (id: string) => void }) {
  const allSent = event.memberCount > 0 && event.sentCount === event.memberCount;
  const color = allSent ? OCCASION_SENT_COLOR : "bg-indigo-100 text-indigo-800 border-indigo-200";
  return (
    <button
      type="button"
      onClick={() => onOpen(event.id)}
      className={`flex w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-xs font-medium hover:opacity-80 ${color}`}
      title={`${event.title} · ${event.sentCount}/${event.memberCount} sent`}
    >
      <span aria-hidden className="shrink-0">
        ✦
      </span>
      <span className="truncate">{event.title}</span>
      <span className="ml-auto shrink-0 tabular-nums opacity-70">
        {event.sentCount}/{event.memberCount}
      </span>
    </button>
  );
}

/** A small key so the colour/tick states aren't a mystery. */
function CalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-3 w-3 rounded-sm border ${OCCASION_SENT_COLOR}`} />
        <span aria-hidden>✓</span> Sent
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className={`inline-block h-3 w-3 rounded-sm border ${OCCASION_TYPE_COLORS.birthday}`}
        />
        Upcoming (coloured by type)
      </span>
      {/* Both are over and both are struck through, so they share a swatch —
          but the key names both. It said only "Skipped", which is the wrong word
          for a date that simply went by, and the one word a customer should
          never read about something they never touched. */}
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-3 w-3 rounded-sm border ${OCCASION_SKIPPED_COLOR}`} />
        Skipped or missed
      </span>
    </div>
  );
}

export function CalendarClient({
  initialOccasions,
  initialTruncated,
  initialTotal,
  initialEvents,
  todayIso,
}: {
  initialOccasions: CalendarOccasion[];
  /** True when the server had more occasions in this range than it returned. */
  initialTruncated: boolean;
  /** How many fall in the range in total, whether or not they were all sent. */
  initialTotal: number;
  initialEvents: EventSummary[];
  todayIso: string;
}) {
  // Memoised so they're stable references across renders — `today` seeds
  // `anchor` and feeds the fetch effects, so rebuilding it each render churned
  // dependencies and contributed to the reload flashing.
  const today = useMemo(() => new Date(todayIso), [todayIso]);
  const todayKey = useMemo(() => ymdUTC(today), [today]);

  // The month/week grids need ~560px to be legible (they scroll horizontally on
  // a phone); the list view is the mobile-friendly one. Default to list on
  // narrow screens, but let an explicit pick override that. Read via
  // useSyncExternalStore so the server + first client render agree on "month"
  // (no hydration mismatch), then it corrects to "list" on a phone after mount.
  const isNarrow = useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia("(max-width: 640px)");
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false,
  );
  const [viewOverride, setView] = useState<CalendarView | null>(null);
  const view: CalendarView = viewOverride ?? (isNarrow ? "list" : "month");
  const [anchor, setAnchor] = useState<Date>(today);
  const [showDispatch, setShowDispatch] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [occasions, setOccasions] = useState<CalendarOccasion[]>(initialOccasions);
  // Never truncate in silence. This is what the reported bug was: the calendar
  // drew one page of 100 and stopped, so a month ended partway through a day
  // with nothing to say why. The server now reports it and the reader is told.
  const [truncated, setTruncated] = useState(initialTruncated);
  const [total, setTotal] = useState(initialTotal);
  const [events, setEvents] = useState<EventSummary[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The occasion whose pop-up is open (null = closed).
  const [selected, setSelected] = useState<CalendarOccasion | null>(null);
  // A whole day, opened from "+N more". A grid cell shows three pills (twelve in
  // week view) and until now the overflow was an inert label, so a day with
  // eight birthdays simply hid five of them with no way to reach them. Nothing
  // is fetched to open it: the client already holds every occasion in range.
  const [openDay, setOpenDay] = useState<string | null>(null);
  // Shared-event pop-up: an existing event id to manage, or a date to create on.
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);
  // List-view multi-select of approved occasions → create one order from them.
  const [orderSelection, setOrderSelection] = useState<Set<string>>(new Set());
  const toggleOrderSelection = useCallback((id: string) => {
    setOrderSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Reflect an inline edit from the pop-up back into the calendar immediately.
  const applyUpdate = useCallback((updated: CalendarOccasion) => {
    setOccasions((current) => current.map((o) => (o.id === updated.id ? updated : o)));
    setSelected(updated);
  }, []);

  const load = useCallback(async () => {
    const { start, end } = fetchRange(view, anchor);
    const params = new URLSearchParams({ from: ymdUTC(start), to: ymdUTC(end) });
    if (typeFilter !== "all") params.set("type", typeFilter);
    setLoading(true);
    setError(null);
    try {
      const result = await clientApiFetch<CalendarOccasionsResponse>(
        `/occasions/calendar?${params.toString()}`,
      );
      setOccasions(result.items);
      setTruncated(result.truncated);
      setTotal(result.total);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : "Could not load the calendar");
    } finally {
      setLoading(false);
    }
  }, [view, anchor, typeFilter]);

  // Drag a card to a new dispatch day (only meaningful with dispatch dates on).
  // Optimistic: move it immediately, then reconcile with the server's response;
  // on failure, surface the error and reload the true state.
  const moveDispatch = useCallback(
    async (occasionId: string, dateKey: string) => {
      setOccasions((current) =>
        current.map((o) =>
          o.id === occasionId
            ? { ...o, dispatchDate: new Date(`${dateKey}T00:00:00Z`), dispatchDateOverridden: true }
            : o,
        ),
      );
      try {
        const updated = await clientApiFetch<CalendarOccasion>(
          `/occasions/${occasionId}/dispatch-date`,
          {
            method: "PATCH",
            body: JSON.stringify({ dispatchDate: dateKey }),
          },
        );
        setOccasions((current) => current.map((o) => (o.id === updated.id ? updated : o)));
      } catch (moveError) {
        setError(
          moveError instanceof ApiError ? moveError.message : "Could not move the dispatch date",
        );
        void load();
      }
    },
    [load],
  );

  // Skip the very first run — the server already rendered the current month.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void load();
  }, [load]);

  // Events are server-seeded for the initial month (see page.tsx), so — like
  // occasions — skip the first run and only re-fetch when the range/filter
  // actually changes. This removes the on-mount fetch that made the calendar
  // flash before settling. A failure here is swallowed: occasions carry the
  // visible error surface.
  const firstEventsRender = useRef(true);
  useEffect(() => {
    if (firstEventsRender.current) {
      firstEventsRender.current = false;
      return;
    }
    let active = true;
    (async () => {
      try {
        const items = await fetchEventsForRange(view, anchor, typeFilter);
        if (active) setEvents(items);
      } catch {
        /* keep whatever events are already shown */
      }
    })();
    return () => {
      active = false;
    };
  }, [view, anchor, typeFilter]);

  // After a create/add/remove/send, refresh both occasions and events.
  const refresh = useCallback(() => {
    void load();
    void (async () => {
      try {
        const items = await fetchEventsForRange(view, anchor, typeFilter);
        setEvents(items);
      } catch {
        /* leave the current events in place */
      }
    })();
  }, [load, view, anchor, typeFilter]);

  function move(delta: number) {
    if (view === "week") {
      setAnchor((a) => addDaysUTC(a, delta * 7));
    } else {
      setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + delta, 1)));
    }
  }

  // Bucket occasions onto their day (occasion date or dispatch date).
  const byDay = new Map<string, CalendarOccasion[]>();
  for (const occasion of occasions) {
    const key = occasionDay(occasion, showDispatch);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(occasion);
    else byDay.set(key, [occasion]);
  }

  // Shared events sit on their event date — one collapsed entry per event.
  const eventsByDay = new Map<string, EventSummary[]>();
  for (const event of events) {
    const key = ymdUTC(new Date(event.eventDate));
    const bucket = eventsByDay.get(key);
    if (bucket) bucket.push(event);
    else eventsByDay.set(key, [event]);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
          <p className="text-muted">
            Every contact’s upcoming moment. Approve and order ahead of time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateDate(todayKey)}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-foreground/[0.03]"
          >
            <span aria-hidden>✦</span> New event
          </button>
          <Link href="/batch-orders" className="btn-accent">
            Create an order <span aria-hidden>→</span>
          </Link>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => move(-1)}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-sm hover:bg-foreground/[0.03]"
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setAnchor(today)}
            className="rounded-md border border-border bg-surface px-3 py-1 text-sm hover:bg-foreground/[0.03]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-sm hover:bg-foreground/[0.03]"
            aria-label="Next"
          >
            ›
          </button>
          <span className="ml-2 text-sm font-semibold">{periodLabel(view, anchor)}</span>
          {loading && <span className="text-xs text-muted">Loading…</span>}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showDispatch}
              onChange={(e) => setShowDispatch(e.target.checked)}
              className="accent-accent"
            />
            Dispatch dates
          </label>
          {showDispatch && view !== "list" && (
            <span className="hidden text-xs text-muted sm:inline">
              Drag a card to re-time its dispatch
            </span>
          )}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1"
          >
            <option value="all">All occasions</option>
            {OCCASION_TYPES.map((type) => (
              <option key={type} value={type}>
                {OCCASION_TYPE_LABELS[type] ?? type}
              </option>
            ))}
          </select>
          <div className="flex rounded-md border border-border bg-surface p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded px-3 py-1 capitalize ${
                  v === view ? "bg-accent text-white" : "hover:bg-foreground/[0.04]"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      {/* The reported bug, made impossible to repeat quietly. The calendar used
          to draw one page of 100 and stop, so a month ended partway through a
          day with nothing to say why — while the week view, being under the cap,
          showed that same day in full. If a range is ever too big to draw whole,
          say so and name the way out. */}
      {truncated && (
        <p className="notice notice-warning">
          Showing the first {occasions.length.toLocaleString("en-GB")} of{" "}
          {total.toLocaleString("en-GB")} events in this range. Switch to week view, or filter by
          occasion type, to see them all.
        </p>
      )}

      <CalendarLegend />

      {view === "list" ? (
        <ListView
          anchor={anchor}
          byDay={byDay}
          eventsByDay={eventsByDay}
          todayKey={todayKey}
          onOpen={setSelected}
          onOpenEvent={setOpenEventId}
          onCreateForDate={setCreateDate}
          orderSelection={orderSelection}
          onToggleOrder={toggleOrderSelection}
        />
      ) : (
        <GridView
          view={view}
          anchor={anchor}
          byDay={byDay}
          eventsByDay={eventsByDay}
          todayKey={todayKey}
          onOpen={setSelected}
          onOpenEvent={setOpenEventId}
          onCreateForDate={setCreateDate}
          onShowDay={setOpenDay}
          showDispatch={showDispatch}
          onMoveDispatch={moveDispatch}
        />
      )}

      {orderSelection.size > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 self-center rounded-full border border-border bg-surface px-4 py-2 shadow-lg">
          <span className="text-sm font-medium">
            {orderSelection.size} approved card{orderSelection.size === 1 ? "" : "s"} selected
          </span>
          <Link
            href={`/batch-orders?occasions=${[...orderSelection].join(",")}`}
            className="btn-accent"
          >
            Create order →
          </Link>
          <button
            type="button"
            onClick={() => setOrderSelection(new Set())}
            className="text-sm text-muted hover:text-accent"
          >
            Clear
          </button>
        </div>
      )}

      {selected && (
        <OccasionModal
          occasion={selected}
          onClose={() => setSelected(null)}
          onUpdated={applyUpdate}
        />
      )}

      {openDay !== null && (
        <DayModal
          dateKey={openDay}
          occasions={byDay.get(openDay) ?? []}
          events={eventsByDay.get(openDay) ?? []}
          onClose={() => setOpenDay(null)}
          onOpen={(occasion) => {
            setOpenDay(null);
            setSelected(occasion);
          }}
          onOpenEvent={(id) => {
            setOpenDay(null);
            setOpenEventId(id);
          }}
        />
      )}

      {(openEventId !== null || createDate !== null) && (
        <EventModal
          eventId={openEventId}
          createDate={createDate ?? todayKey}
          onClose={() => {
            setOpenEventId(null);
            setCreateDate(null);
          }}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

/** "Mon 14 September" — the heading a day pop-up wants, and the label its
 * trigger announces to a screen reader. */
function dayLabel(day: Date): string {
  return day.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * One day, in full.
 *
 * A month cell has room for three pills and a week cell for twelve, so a busy
 * day has always been partly hidden — the difference is that the overflow used
 * to be an inert `<span>`, leaving no way at all to reach the rest. This is that
 * way. It needs no fetch: every occasion in the visible range is already in the
 * client, which is what made the old label so odd — the data was right there.
 */
function DayModal({
  dateKey,
  occasions,
  events,
  onClose,
  onOpen,
  onOpenEvent,
}: {
  dateKey: string;
  occasions: CalendarOccasion[];
  events: EventSummary[];
  onClose: () => void;
  onOpen: (occasion: CalendarOccasion) => void;
  onOpenEvent: (id: string) => void;
}) {
  const total = occasions.length + events.length;
  return (
    <Modal open onClose={onClose} title={dayLabel(new Date(`${dateKey}T00:00:00Z`))}>
      <p className="text-sm text-muted">
        {total} event{total === 1 ? "" : "s"} on this day
      </p>
      <div className="mt-3 flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
        {events.map((event) => (
          <EventPill key={event.id} event={event} onOpen={onOpenEvent} />
        ))}
        {occasions.map((occasion) => (
          <OccasionPill key={occasion.id} occasion={occasion} onOpen={onOpen} />
        ))}
      </div>
    </Modal>
  );
}

function GridView({
  view,
  anchor,
  byDay,
  eventsByDay,
  todayKey,
  onOpen,
  onOpenEvent,
  onCreateForDate,
  onShowDay,
  showDispatch,
  onMoveDispatch,
}: {
  view: CalendarView;
  anchor: Date;
  byDay: Map<string, CalendarOccasion[]>;
  eventsByDay: Map<string, EventSummary[]>;
  todayKey: string;
  onOpen: (occasion: CalendarOccasion) => void;
  onOpenEvent: (id: string) => void;
  onCreateForDate: (dateKey: string) => void;
  /** Open a day in full — what "+N more" is for. */
  onShowDay: (dateKey: string) => void;
  showDispatch: boolean;
  onMoveDispatch: (occasionId: string, dateKey: string) => void;
}) {
  const { start } = view === "week" ? weekRange(anchor) : monthGridRange(anchor);
  const dayCount = view === "week" ? 7 : 42;
  const days = Array.from({ length: dayCount }, (_, i) => addDaysUTC(start, i));
  const cellHeight = view === "week" ? "min-h-40" : "min-h-24";

  return (
    <div className="card overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="grid grid-cols-7 border-b border-border bg-foreground/[0.02] text-xs font-semibold uppercase tracking-wide text-muted">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2.5 text-center">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = ymdUTC(day);
            const inMonth = view === "week" || day.getUTCMonth() === anchor.getUTCMonth();
            const isToday = key === todayKey;
            const dayEvents = eventsByDay.get(key) ?? [];
            const dayOccasions = byDay.get(key) ?? [];
            const cap = view === "week" ? 12 : 3;
            const shown = dayOccasions.slice(0, Math.max(0, cap - dayEvents.length));
            const extra = dayOccasions.length - shown.length;
            return (
              <div
                key={key}
                onDoubleClick={() => onCreateForDate(key)}
                onDragOver={showDispatch ? (e) => e.preventDefault() : undefined}
                onDrop={
                  showDispatch
                    ? (e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/plain");
                        if (id) onMoveDispatch(id, key);
                      }
                    : undefined
                }
                title="Double-click to create an event"
                className={`group ${cellHeight} flex flex-col gap-1 border-t border-l border-border p-1.5 first:border-l-0 ${
                  isToday ? "bg-accent-soft/50" : inMonth ? "" : "bg-foreground/[0.02] text-muted"
                } ${showDispatch ? "hover:bg-accent-soft/30" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => onCreateForDate(key)}
                    aria-label="Create an event on this day"
                    className="text-xs text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                  >
                    + event
                  </button>
                  <span
                    className={`text-xs ${
                      isToday
                        ? "flex h-5 w-5 items-center justify-center rounded-full bg-foreground font-semibold text-white"
                        : "text-muted"
                    }`}
                  >
                    {day.getUTCDate()}
                  </span>
                </div>
                {dayEvents.map((event) => (
                  <EventPill key={event.id} event={event} onOpen={onOpenEvent} />
                ))}
                {shown.map((occasion) => (
                  <OccasionPill
                    key={occasion.id}
                    occasion={occasion}
                    onOpen={onOpen}
                    draggable={
                      showDispatch &&
                      occasionProgress(occasion.status, occasion.order?.status) === "upcoming"
                    }
                  />
                ))}
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={() => onShowDay(key)}
                    aria-label={`Show all ${dayOccasions.length + dayEvents.length} events on ${dayLabel(day)}`}
                    className="rounded px-1 text-left text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    +{extra} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListView({
  anchor,
  byDay,
  eventsByDay,
  todayKey,
  onOpen,
  onOpenEvent,
  onCreateForDate,
  orderSelection,
  onToggleOrder,
}: {
  anchor: Date;
  byDay: Map<string, CalendarOccasion[]>;
  eventsByDay: Map<string, EventSummary[]>;
  todayKey: string;
  onOpen: (occasion: CalendarOccasion) => void;
  onOpenEvent: (id: string) => void;
  onCreateForDate: (dateKey: string) => void;
  orderSelection: Set<string>;
  onToggleOrder: (id: string) => void;
}) {
  // Constrain to the anchor's forward window (the server union-seed can carry a
  // few trailing days of the previous month from the month grid — those aren't
  // part of the list agenda), then group the days by their month so the list
  // reads "This month → Next month → Month Year" across boundaries.
  const { start, end } = listWindowRange(anchor);
  const startKey = ymdUTC(start);
  const endKey = ymdUTC(end);
  const days = [...new Set([...byDay.keys(), ...eventsByDay.keys()])]
    .filter((key) => key >= startKey && key <= endKey)
    .sort();

  if (days.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-muted">
        Nothing coming up between {periodLabel("list", anchor)}.
      </div>
    );
  }

  // Group the day keys by "YYYY-MM", preserving chronological order.
  const groups: { monthKey: string; monthDate: Date; days: string[] }[] = [];
  for (const key of days) {
    const monthKey = key.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.monthKey === monthKey) {
      last.days.push(key);
    } else {
      groups.push({ monthKey, monthDate: new Date(`${monthKey}-01T00:00:00Z`), days: [key] });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div
          key={group.monthKey}
          className="card flex flex-col divide-y divide-border overflow-hidden"
        >
          <div className="flex items-baseline justify-between gap-2 bg-foreground/[0.02] px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              {relativeMonthLabel(group.monthDate, todayKey)}
              {/* "This month"/"Next month" gain the actual month name; a further-out
                  month's label already IS the month + year, so don't repeat it. */}
              {isRelativeMonthLabel(group.monthDate, todayKey) && (
                <span className="ml-2 font-normal text-muted">
                  {group.monthDate.toLocaleDateString("en-GB", {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </span>
              )}
            </h2>
            <span className="text-xs text-muted">
              {group.days.length} day{group.days.length === 1 ? "" : "s"} with events
            </span>
          </div>
          {group.days.map((key) => {
            const date = new Date(`${key}T00:00:00Z`);
            return (
              <div
                key={key}
                className="group flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-6"
              >
                <div className="flex w-40 shrink-0 items-center gap-2 text-sm font-semibold">
                  <span>
                    {date.toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "long",
                      timeZone: "UTC",
                    })}
                    {key === todayKey && <span className="ml-2 text-xs text-accent">Today</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => onCreateForDate(key)}
                    aria-label="Create an event on this day"
                    className="text-xs text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                  >
                    + event
                  </button>
                </div>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {(eventsByDay.get(key) ?? []).map((event) => (
                    <div key={event.id} className="max-w-56">
                      <EventPill event={event} onOpen={onOpenEvent} />
                    </div>
                  ))}
                  {(byDay.get(key) ?? []).map((occasion) => {
                    // Only an approved occasion (a design has been chosen) can be
                    // ticked straight into an order. An upcoming one still needs
                    // approving first — show a muted placeholder in the checkbox
                    // column so the row lines up, and explain why on hover/click.
                    const orderable = occasion.status === "approved";
                    const needsApproval = occasion.status === "pending_approval";
                    return (
                      <div key={occasion.id} className="flex max-w-56 items-center gap-1.5">
                        {orderable ? (
                          <input
                            type="checkbox"
                            checked={orderSelection.has(occasion.id)}
                            onChange={() => onToggleOrder(occasion.id)}
                            title="Select to include in an order"
                            className="accent-accent"
                          />
                        ) : needsApproval ? (
                          <span
                            aria-hidden
                            title="Approve this occasion (choose a design in Approvals) to add it to an order"
                            className="inline-block size-3 shrink-0 rounded-[3px] border border-warning/40 bg-warning-soft"
                          />
                        ) : null}
                        <OccasionPill occasion={occasion} onOpen={onOpen} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
