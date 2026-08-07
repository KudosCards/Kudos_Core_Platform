"use client";

import { useEffect, useState } from "react";
import type { MessagePageInsights } from "@kudos/shared-types";
import { clientApiFetch } from "@/lib/api.client";
import { FunnelBar } from "./funnel-bar";

/** This page's engagement funnel, fetched on mount (Phase 3, ADR 0132). */
export function InsightsPanel({ pageId }: { pageId: string }) {
  const [insights, setInsights] = useState<MessagePageInsights | null>(null);

  useEffect(() => {
    let active = true;
    void clientApiFetch<MessagePageInsights>(`/message-pages/${pageId}/insights`)
      .then((data) => {
        if (active) setInsights(data);
      })
      .catch(() => {
        /* insights are informational — a fetch failure just leaves the panel empty */
      });
    return () => {
      active = false;
    };
  }, [pageId]);

  if (!insights) {
    return <div className="mt-4 h-24 animate-pulse rounded-2xl bg-foreground/5" />;
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <p className="section-label">Engagement</p>
      <FunnelBar funnel={insights.funnel} />
      {insights.firstViewedAt && (
        <p className="text-xs text-muted">
          First opened{" "}
          {new Date(insights.firstViewedAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      )}
    </div>
  );
}
