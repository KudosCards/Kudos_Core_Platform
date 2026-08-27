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
  // The outcome tagged with the window it's FOR, so switching ranges shows the
  // skeleton (derived as "loading") until the matching fetch lands — no
  // synchronous reset inside the effect. `"error"` distinguishes a failed fetch
  // from an in-flight one so we hide the chart instead of showing a skeleton
  // forever.
  const [loaded, setLoaded] = useState<{
    days: number;
    result: MessagePageTimeSeries | "error";
  } | null>(null);

  useEffect(() => {
    let active = true;
    void clientApiFetch<MessagePageTimeSeries>(`${path}?days=${days}`)
      .then((data) => {
        if (active) setLoaded({ days, result: data });
      })
      .catch(() => {
        if (active) setLoaded({ days, result: "error" });
      });
    return () => {
      active = false;
    };
  }, [path, days]);

  const current = loaded && loaded.days === days ? loaded.result : null;

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
                days === range
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-foreground/[0.04]"
              }`}
            >
              {range}d
            </button>
          ))}
        </div>
      </div>
      {current === null ? (
        <div className="h-32 animate-pulse rounded-lg bg-foreground/5" />
      ) : current === "error" ? (
        <p className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-xs text-muted">
          Couldn&apos;t load the trend just now.
        </p>
      ) : (
        <TrendChart series={current} />
      )}
    </div>
  );
}
