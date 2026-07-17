import type { Occasion } from "@kudos/shared-types";
import { serverApiFetch } from "@/lib/api.server";
import { CalendarClient } from "./calendar-client";
import { monthGridRange, ymdUTC, type Paginated } from "./calendar-utils";

export default async function CalendarPage() {
  // Server-render the current month so the grid is populated on first paint.
  const now = new Date();
  const { start, end } = monthGridRange(now);
  const result = await serverApiFetch<Paginated<Occasion>>(
    `/occasions?from=${ymdUTC(start)}&to=${ymdUTC(end)}&perPage=100`,
  );

  return <CalendarClient initialOccasions={result?.items ?? []} todayIso={now.toISOString()} />;
}
