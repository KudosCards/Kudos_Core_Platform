import type { EventSummary, Occasion } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { CalendarClient } from "./calendar-client";
import { listWindowRange, monthGridRange, ymdUTC, type Paginated } from "./calendar-utils";

export default async function CalendarPage() {
  // Server-render enough to populate BOTH first-paint views without a flash:
  // the month grid (desktop default) and the list view's forward window (mobile
  // default). The union runs from the month grid's start (the Monday before the
  // 1st) through the list window's end (a few months out), so whichever view the
  // client settles on already has its occasions AND shared events — no on-mount
  // fetch, no blank → occasions → events flash.
  const now = new Date();
  const { start } = monthGridRange(now);
  const { end } = listWindowRange(now);
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
