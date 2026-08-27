"use client";

import { useId, useState } from "react";
import type { MessagePageTimeSeries } from "@kudos/shared-types";

/**
 * Daily engagement over a window (ADR 0136, Phase 5): views/clicks/replies as
 * three lines. A hand-rolled SVG — no chart dependency — matching the app's
 * custom calendar-grid approach.
 *
 * Series colours are the Okabe-Ito CVD-safe categorical set, validated with the
 * dataviz palette checker on the app's light surface (the app renders light-only;
 * the matching dark-surface set — #3596CE / #C0891F / #1B926F — is validated and
 * ready if dark mode is ever enabled). Identity is never colour-alone: every
 * series is named in the legend and its exact value shown on hover.
 */
const SERIES = [
  { key: "views", label: "Views", color: "#0072B2" },
  { key: "clicks", label: "Clicks", color: "#E69F00" },
  { key: "replies", label: "Replies", color: "#009E73" },
] as const;

// viewBox units; the SVG scales to its container width.
const W = 320;
const H = 120;
const M = { top: 8, right: 6, bottom: 18, left: 6 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

function shortDate(iso: string): string {
  // iso is YYYY-MM-DD (UTC calendar day); render as "5 Aug".
  const parts = iso.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function TrendChart({ series }: { series: MessagePageTimeSeries }) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const points = series.points;
  const n = points.length;

  const maxY = Math.max(1, ...points.flatMap((p) => [p.views, p.clicks, p.replies]));
  const total = points.reduce((sum, p) => sum + p.views + p.clicks + p.replies, 0);

  if (total === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface px-3 py-6 text-center text-xs text-muted">
        No activity in the last {series.days} days yet — it&apos;ll show here once cards are opened.
      </p>
    );
  }

  const x = (i: number) => M.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => M.top + (1 - v / maxY) * PLOT_H;
  const path = (key: (typeof SERIES)[number]["key"]) =>
    points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`)
      .join(" ");

  const hovered = hover === null ? null : points[hover];
  const firstPoint = points[0];
  const lastPoint = points[n - 1];

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-labelledby={titleId}
          preserveAspectRatio="none"
        >
          <title id={titleId}>
            Daily views, clicks and replies over the last {series.days} days
          </title>
          {/* Recessive baseline + top gridline. */}
          <line
            x1={M.left}
            x2={W - M.right}
            y1={y(0)}
            y2={y(0)}
            className="stroke-border"
            strokeWidth={1}
          />
          <line
            x1={M.left}
            x2={W - M.right}
            y1={y(maxY)}
            y2={y(maxY)}
            className="stroke-border/50"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          {SERIES.map((s) => (
            <path
              key={s.key}
              d={path(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hover !== null && hovered && (
            <>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={M.top}
                y2={y(0)}
                className="stroke-foreground/30"
                strokeWidth={1}
              />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(hovered[s.key])} r={3} fill={s.color} />
              ))}
            </>
          )}
          {/* Invisible hit layer: snap to the nearest day under the cursor. */}
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="transparent"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const px = ((event.clientX - rect.left) / rect.width) * W;
              const i = Math.round(((px - M.left) / PLOT_W) * (n - 1));
              setHover(Math.max(0, Math.min(n - 1, i)));
            }}
          />
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute -top-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-[11px] shadow-sm"
            style={{
              left: `${(x(hover ?? 0) / W) * 100}%`,
              transform: `translateX(${(hover ?? 0) > n / 2 ? "-100%" : "0"})`,
            }}
          >
            <p className="font-medium tabular-nums">{shortDate(hovered.date)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5 tabular-nums text-muted">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {hovered[s.key]} {s.label.toLowerCase()}
              </p>
            ))}
          </div>
        )}
      </div>

      <figcaption className="flex items-center justify-between text-[11px] text-muted">
        <span>{firstPoint && shortDate(firstPoint.date)}</span>
        <span className="flex items-center gap-3">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
          ))}
        </span>
        <span>{lastPoint && shortDate(lastPoint.date)}</span>
      </figcaption>
    </figure>
  );
}
