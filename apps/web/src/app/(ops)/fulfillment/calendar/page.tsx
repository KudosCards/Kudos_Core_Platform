import type { FulfillmentCalendar } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { fetchRange, ymdUTC, type CalendarView } from "@/lib/calendar-grid";
import { DispatchCalendarClient } from "./calendar-client";

const VALID_VIEWS: CalendarView[] = ["month", "week", "list"];

/** Parse a YYYY-MM-DD anchor to a UTC-midnight Date, falling back to today. */
function parseAnchor(value: string | undefined): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!));
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export default async function DispatchCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const { view: viewParam, date: dateParam } = await searchParams;
  const view: CalendarView = VALID_VIEWS.includes(viewParam as CalendarView)
    ? (viewParam as CalendarView)
    : "month";
  const anchor = parseAnchor(dateParam);

  const { start, end } = fetchRange(view, anchor);
  const calendar = await serverApiFetch<FulfillmentCalendar>(
    `/fulfillment/calendar?from=${ymdUTC(start)}&to=${ymdUTC(end)}`,
  );

  return (
    <DispatchCalendarClient
      view={view}
      anchor={ymdUTC(anchor)}
      calendar={calendar ?? { days: [], overdueBefore: 0 }}
    />
  );
}
