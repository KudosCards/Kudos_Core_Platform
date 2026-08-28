import type { CalendarOccasionsResponse, EventSummary } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { CalendarClient } from "./calendar-client";
import { listWindowRange, monthGridRange, ymdUTC } from "./calendar-utils";

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
  // The calendar's own read, not the paginated `/occasions` list. That one caps
  // at 100 rows, which silently cut a 2,000-contact account's month off partway
  // through a day, and carries each contact's postal address for checkout
  // pre-fill — which no calendar pill renders. See ADR 0173.
  const [occasions, events] = await Promise.all([
    serverApiFetch<CalendarOccasionsResponse>(`/occasions/calendar?${range}`),
    serverApiFetch<EventSummary[]>(`/events?${range}`),
  ]);

  return (
    <CalendarClient
      initialOccasions={occasions?.items ?? []}
      initialTruncated={occasions?.truncated ?? false}
      initialTotal={occasions?.total ?? 0}
      initialEvents={events ?? []}
      todayIso={now.toISOString()}
    />
  );
}
