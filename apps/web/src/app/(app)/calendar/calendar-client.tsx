"use client";

import type { Occasion } from "@kudos/shared-types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { OCCASION_TYPE_LABELS } from "@/lib/occasions";
import {
  addDaysUTC,
  fetchRange,
  monthGridRange,
  occasionDay,
  weekRange,
  ymdUTC,
  OCCASION_TYPE_COLORS,
  OCCASION_TYPES,
  type CalendarView,
  type Paginated,
} from "./calendar-utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VIEWS: CalendarView[] = ["month", "week", "list"];

/** Where a click on an occasion should take the operator. */
function occasionHref(occasion: Occasion): string | null {
  if (occasion.status === "pending_approval") return "/approvals";
  if (occasion.status === "approved") return "/batch-orders";
  return null;
}

function occasionLabel(occasion: Occasion): string {
  if (occasion.recipient) {
    return `${occasion.recipient.firstName} ${occasion.recipient.lastName}`;
  }
  return OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type;
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
  return anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function OccasionPill({ occasion }: { occasion: Occasion }) {
  const color = OCCASION_TYPE_COLORS[occasion.type] ?? OCCASION_TYPE_COLORS.bespoke_campaign;
  const href = occasionHref(occasion);
  const inner = (
    <span
      className={`block truncate rounded border px-1.5 py-0.5 text-xs ${color}`}
      title={`${occasionLabel(occasion)} · ${OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type}`}
    >
      {occasionLabel(occasion)}
    </span>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-80">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function CalendarClient({
  initialOccasions,
  todayIso,
}: {
  initialOccasions: Occasion[];
  todayIso: string;
}) {
  const today = new Date(todayIso);
  const todayKey = ymdUTC(today);

  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState<Date>(today);
  const [showDispatch, setShowDispatch] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [occasions, setOccasions] = useState<Occasion[]>(initialOccasions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { start, end } = fetchRange(view, anchor);
    const params = new URLSearchParams({ from: ymdUTC(start), to: ymdUTC(end), perPage: "100" });
    if (typeFilter !== "all") params.set("type", typeFilter);
    setLoading(true);
    setError(null);
    try {
      const result = await clientApiFetch<Paginated<Occasion>>(`/occasions?${params.toString()}`);
      setOccasions(result.items);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : "Could not load the calendar");
    } finally {
      setLoading(false);
    }
  }, [view, anchor, typeFilter]);

  // Skip the very first run — the server already rendered the current month.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void load();
  }, [load]);

  function move(delta: number) {
    if (view === "week") {
      setAnchor((a) => addDaysUTC(a, delta * 7));
    } else {
      setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + delta, 1)));
    }
  }

  // Bucket occasions onto their day (occasion date or dispatch date).
  const byDay = new Map<string, Occasion[]>();
  for (const occasion of occasions) {
    const key = occasionDay(occasion, showDispatch);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(occasion);
    else byDay.set(key, [occasion]);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-foreground/60">
            Every contact&apos;s upcoming moments. Approve and order them ahead of time.
          </p>
        </div>
        <Link
          href="/batch-orders"
          className="rounded-full bg-foreground px-4 py-2 text-sm text-background hover:opacity-90"
        >
          Create an order →
        </Link>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => move(-1)}
            className="rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setAnchor(today)}
            className="rounded-md border border-black/15 px-3 py-1 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => move(1)}
            className="rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
            aria-label="Next"
          >
            ›
          </button>
          <span className="ml-2 text-sm font-medium">{periodLabel(view, anchor)}</span>
          {loading && <span className="text-xs text-foreground/40">Loading…</span>}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showDispatch}
              onChange={(e) => setShowDispatch(e.target.checked)}
            />
            Dispatch dates
          </label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-black/15 px-2 py-1 dark:border-white/15"
          >
            <option value="all">All occasions</option>
            {OCCASION_TYPES.map((type) => (
              <option key={type} value={type}>
                {OCCASION_TYPE_LABELS[type] ?? type}
              </option>
            ))}
          </select>
          <div className="flex rounded-md border border-black/15 p-0.5 dark:border-white/15">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded px-3 py-1 capitalize ${
                  v === view ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {view === "list" ? (
        <ListView anchor={anchor} byDay={byDay} todayKey={todayKey} />
      ) : (
        <GridView view={view} anchor={anchor} byDay={byDay} todayKey={todayKey} />
      )}
    </div>
  );
}

function GridView({
  view,
  anchor,
  byDay,
  todayKey,
}: {
  view: CalendarView;
  anchor: Date;
  byDay: Map<string, Occasion[]>;
  todayKey: string;
}) {
  const { start } = view === "week" ? weekRange(anchor) : monthGridRange(anchor);
  const dayCount = view === "week" ? 7 : 42;
  const days = Array.from({ length: dayCount }, (_, i) => addDaysUTC(start, i));
  const cellHeight = view === "week" ? "min-h-40" : "min-h-24";

  return (
    <div className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
      <div className="grid grid-cols-7 border-b border-black/10 bg-black/[0.03] text-xs font-semibold text-foreground/60 dark:border-white/10 dark:bg-white/[0.03]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = ymdUTC(day);
          const inMonth = view === "week" || day.getUTCMonth() === anchor.getUTCMonth();
          const isToday = key === todayKey;
          const dayOccasions = byDay.get(key) ?? [];
          const shown = dayOccasions.slice(0, view === "week" ? 12 : 3);
          const extra = dayOccasions.length - shown.length;
          return (
            <div
              key={key}
              className={`${cellHeight} flex flex-col gap-1 border-t border-l border-black/10 p-1.5 first:border-l-0 dark:border-white/10 ${
                inMonth ? "" : "bg-black/[0.02] text-foreground/40 dark:bg-white/[0.02]"
              }`}
            >
              <span
                className={`self-end text-xs ${
                  isToday
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background"
                    : "text-foreground/50"
                }`}
              >
                {day.getUTCDate()}
              </span>
              {shown.map((occasion) => (
                <OccasionPill key={occasion.id} occasion={occasion} />
              ))}
              {extra > 0 && <span className="px-1 text-xs text-foreground/40">+{extra} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({
  anchor,
  byDay,
  todayKey,
}: {
  anchor: Date;
  byDay: Map<string, Occasion[]>;
  todayKey: string;
}) {
  const days = [...byDay.keys()].sort();
  if (days.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        No occasions in {anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}.
      </p>
    );
  }
  return (
    <div className="flex flex-col divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
      {days.map((key) => {
        const date = new Date(`${key}T00:00:00Z`);
        return (
          <div key={key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-6">
            <div className="w-40 shrink-0 text-sm font-medium">
              {date.toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              })}
              {key === todayKey && <span className="ml-2 text-xs text-foreground/40">Today</span>}
            </div>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {(byDay.get(key) ?? []).map((occasion) => (
                <div key={occasion.id} className="max-w-48">
                  <OccasionPill occasion={occasion} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
