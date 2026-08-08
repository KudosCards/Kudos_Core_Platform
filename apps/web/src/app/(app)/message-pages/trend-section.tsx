"use client";

import { useEffect, useState } from "react";
import type { MessagePageTimeSeries } from "@kudos/shared-types";
import { clientApiFetch } from "@/lib/api.client";
import { TrendChart } from "./trend-chart";

const RANGES = [7, 30, 90] as const;

/**
 * A days-window toggle plus the daily engagement trend chart, fetched from a
 * timeseries endpoint (page- or account-scoped). Shared by the builder insights
 * panel and the library's account strip. Phase 5, ADR 0136.
 */
export function TrendSection({ path }: { path: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  // Store the window the data is FOR, so switching ranges shows the skeleton
  // (series derived as null) until the matching fetch lands — no synchronous
  // reset inside the effect.
  const [loaded, setLoaded] = useState<{ days: number; series: MessagePageTimeSeries } | null>(null);

  useEffect(() => {
    let active = true;
    void clientApiFetch<MessagePageTimeSeries>(`${path}?days=${days}`)
      .then((data) => {
        if (active) setLoaded({ days, series: data });
      })
      .catch(() => {
        /* the trend is informational — a fetch failure just hides the chart */
      });
    return () => {
      active = false;
    };
  }, [path, days]);

  const series = loaded && loaded.days === days ? loaded.series : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="section-label">Trend</p>
        <div className="flex items-center gap-1" role="group" aria-label="Trend window">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              aria-pressed={days === range}
              className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums transition-colors ${
                days === range ? "bg-accent-soft text-accent" : "text-muted hover:bg-foreground/[0.04]"
              }`}
            >
              {range}d
            </button>
          ))}
        </div>
      </div>
      {series ? (
        <TrendChart series={series} />
      ) : (
        <div className="h-32 animate-pulse rounded-lg bg-foreground/5" />
      )}
    </div>
  );
}
