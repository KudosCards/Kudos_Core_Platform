import type { MessagePageFunnel } from "@kudos/shared-types";

/**
 * The engagement funnel (Phase 3, ADR 0132): how many cards were sent, then
 * opened, then had the CTA clicked, then were replied to — each stage as a count
 * with its conversion off "sent". Pure presentational, so both the server-
 * rendered library strip and the client-rendered builder panel can use it.
 */
const STAGES = [
  { key: "sent", label: "Sent" },
  { key: "viewed", label: "Viewed" },
  { key: "clicked", label: "Clicked" },
  { key: "replied", label: "Replied" },
] as const;

export function FunnelBar({ funnel }: { funnel: MessagePageFunnel }) {
  const pct = (n: number) => (funnel.sent > 0 ? Math.round((n / funnel.sent) * 100) : 0);
  return (
    <div className="grid grid-cols-4 gap-2">
      {STAGES.map((stage, index) => (
        <div
          key={stage.key}
          className="rounded-lg border border-border bg-surface px-2 py-2.5 text-center"
        >
          <p className="text-xl font-bold tabular-nums">{funnel[stage.key]}</p>
          <p className="text-xs font-medium">{stage.label}</p>
          {index > 0 && (
            <p className="text-[11px] tabular-nums text-muted">{pct(funnel[stage.key])}%</p>
          )}
        </div>
      ))}
    </div>
  );
}
