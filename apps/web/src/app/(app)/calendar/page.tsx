import type { EventSummary, Occasion } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { CalendarClient } from "./calendar-client";
import { monthGridRange, ymdUTC, type Paginated } from "./calendar-utils";

export default async function CalendarPage() {
  // Server-render the current month so the grid is fully populated on first
  // paint — both occasions AND shared events. Seeding events too means the
  // client no longer has to fetch them on mount, which was causing the calendar
  // to flash (blank → occasions → events) before settling.
  const now = new Date();
  const { start, end } = monthGridRange(now);
  const range = `from=${ymdUTC(start)}&to=${ymdUTC(end)}`;
  const [occasions, events] = await Promise.all([
    serverApiFetch<Paginated<Occasion>>(`/occasions?${range}&perPage=100`),
    serverApiFetch<EventSummary[]>(`/events?${range}`),
  ]);

  return (
    <CalendarClient
      initialOccasions={occasions?.items ?? []}
      initialEvents={events ?? []}
      todayIso={now.toISOString()}
    />
  );
}
