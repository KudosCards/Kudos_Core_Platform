"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FulfillmentCalendar, FulfillmentCalendarDay } from "@kudos/shared-types";
import { addDaysUTC, monthGridRange, ymdUTC, type CalendarView } from "@/lib/calendar-grid";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VIEWS: { key: CalendarView; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "list", label: "List" },
];

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function todayYmd(): string {
  const now = new Date();
  return ymdUTC(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

/** Urgency tone for a day's count: red once the deadline has passed and cards
 * are still open, amber today, neutral-green ahead. Mirrors the queue badges. */
function dayTone(ymd: string, count: number, today: string): string {
  if (count === 0) return "";
  if (ymd < today) return "bg-red-100 text-red-800";
  if (ymd === today) return "bg-amber-100 text-amber-900";
  return "bg-emerald-100 text-emerald-800";
}

function monthLabel(anchor: Date): string {
  return anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function DispatchCalendarClient({
  view,
  anchor,
  calendar,
}: {
  view: CalendarView;
  anchor: string;
  calendar: FulfillmentCalendar;
}) {
  const router = useRouter();
  const anchorDate = parseYmd(anchor);
  const today = todayYmd();

  const byDay = useMemo(() => {
    const map = new Map<string, FulfillmentCalendarDay>();
    for (const d of calendar.days) map.set(d.day, d);
    return map;
  }, [calendar.days]);

  function go(nextView: CalendarView, nextAnchor: Date) {
    router.push(`/fulfillment/calendar?view=${nextView}&date=${ymdUTC(nextAnchor)}`);
  }

  function step(direction: -1 | 1) {
    if (view === "week") {
      go(view, addDaysUTC(anchorDate, direction * 7));
    } else {
      // month + list both step by a whole month.
      go(
        view,
        new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + direction, 1)),
      );
    }
  }

  const totalInView = calendar.days.reduce((sum, d) => sum + d.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Dispatch calendar</h1>
          <Link href="/fulfillment" className="text-sm text-muted hover:text-accent">
            ← Dispatch queue
          </Link>
        </div>
        <p className="text-sm text-muted">
          Cards still to post, by their deadline · {totalInView.toLocaleString("en-GB")} in view.
        </p>
      </div>

      {calendar.overdueBefore > 0 && (
        <Link
          href="/fulfillment?due=overdue"
          className="flex items-center justify-between rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 hover:bg-red-100"
        >
          <span>
            <strong className="tabular-nums">
              {calendar.overdueBefore.toLocaleString("en-GB")}
            </strong>{" "}
            card{calendar.overdueBefore === 1 ? "" : "s"} overdue before this window
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}

      {/* View toggle + period nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 text-sm">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => go(v.key, anchorDate)}
              className={`rounded-full px-3 py-1 ${
                v.key === view
                  ? "bg-foreground text-background"
                  : "border border-border hover:bg-foreground/[0.04]"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous"
            className="rounded-lg border border-border px-3 py-1.5 hover:bg-foreground/[0.04]"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => go(view, parseYmd(today))}
            className="rounded-lg border border-border px-3 py-1.5 hover:bg-foreground/[0.04]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next"
            className="rounded-lg border border-border px-3 py-1.5 hover:bg-foreground/[0.04]"
          >
            ›
          </button>
          <span className="ml-1 font-medium">{monthLabel(anchorDate)}</span>
        </div>
      </div>

      {view === "month" && <MonthGrid anchor={anchorDate} byDay={byDay} today={today} />}
      {view === "week" && <WeekStrip anchor={anchorDate} byDay={byDay} today={today} />}
      {view === "list" && <AgendaList days={calendar.days} today={today} />}
    </div>
  );
}

function DayCount({
  day,
  ymd,
  today,
}: {
  day: FulfillmentCalendarDay | undefined;
  ymd: string;
  today: string;
}) {
  if (!day || day.total === 0) return null;
  return (
    <Link
      href={`/fulfillment?dueOn=${ymd}`}
      className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${dayTone(
        ymd,
        day.total,
        today,
      )}`}
      title={`${day.pending} pending · ${day.inProgress} in progress · ${day.printed} printed`}
    >
      {day.total} to post
    </Link>
  );
}

function MonthGrid({
  anchor,
  byDay,
  today,
}: {
  anchor: Date;
  byDay: Map<string, FulfillmentCalendarDay>;
  today: string;
}) {
  const { start } = monthGridRange(anchor);
  const cells = Array.from({ length: 42 }, (_, i) => addDaysUTC(start, i));
  const anchorMonth = anchor.getUTCMonth();

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 gap-px rounded-xl border border-border bg-border">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-surface px-2 py-2 text-center text-xs font-medium text-muted">
            {w}
          </div>
        ))}
        {cells.map((cell) => {
          const ymd = ymdUTC(cell);
          const inMonth = cell.getUTCMonth() === anchorMonth;
          const isToday = ymd === today;
          return (
            <div
              key={ymd}
              className={`min-h-[84px] bg-surface p-2 ${inMonth ? "" : "opacity-40"} ${
                isToday ? "ring-2 ring-inset ring-accent" : ""
              }`}
            >
              <span className="text-xs tabular-nums text-muted">{cell.getUTCDate()}</span>
              <div>
                <DayCount day={byDay.get(ymd)} ymd={ymd} today={today} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekStrip({
  anchor,
  byDay,
  today,
}: {
  anchor: Date;
  byDay: Map<string, FulfillmentCalendarDay>;
  today: string;
}) {
  // The week's Monday: reuse monthGridRange isn't right here; compute directly.
  const isoDow = (anchor.getUTCDay() + 6) % 7;
  const monday = addDaysUTC(anchor, -isoDow);
  const days = Array.from({ length: 7 }, (_, i) => addDaysUTC(monday, i));

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 gap-2">
        {days.map((cell) => {
          const ymd = ymdUTC(cell);
          const day = byDay.get(ymd);
          const isToday = ymd === today;
          return (
            <div
              key={ymd}
              className={`flex min-h-[140px] flex-col rounded-xl border border-border p-3 ${
                isToday ? "ring-2 ring-inset ring-accent" : ""
              }`}
            >
              <p className="text-xs font-medium text-muted">
                {cell.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}{" "}
                {cell.getUTCDate()}
              </p>
              {day && day.total > 0 ? (
                <Link href={`/fulfillment?dueOn=${ymd}`} className="mt-2 flex flex-col gap-1">
                  <span
                    className={`self-start rounded-full px-2 py-0.5 text-sm font-semibold tabular-nums ${dayTone(
                      ymd,
                      day.total,
                      today,
                    )}`}
                  >
                    {day.total} to post
                  </span>
                  <span className="text-xs text-muted">
                    {day.pending} pending · {day.printed} printed
                  </span>
                </Link>
              ) : (
                <span className="mt-2 text-xs text-muted">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgendaList({ days, today }: { days: FulfillmentCalendarDay[]; today: string }) {
  const withCards = days.filter((d) => d.total > 0);
  if (withCards.length === 0) {
    return (
      <p className="rounded-xl border border-border p-6 text-sm text-muted">
        Nothing to post in this window.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {withCards.map((day) => {
        const date = parseYmd(day.day);
        return (
          <Link
            key={day.day}
            href={`/fulfillment?dueOn=${day.day}`}
            className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3 hover:bg-foreground/[0.02]"
          >
            <div>
              <p className="font-medium">
                {date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })},{" "}
                {shortDate(date)}
              </p>
              <p className="text-xs text-muted">
                {day.pending} pending · {day.inProgress} in progress · {day.printed} printed
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold tabular-nums ${dayTone(
                day.day,
                day.total,
                today,
              )}`}
            >
              {day.total} to post
            </span>
          </Link>
        );
      })}
    </div>
  );
}
