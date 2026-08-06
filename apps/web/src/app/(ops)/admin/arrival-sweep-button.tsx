"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface ArrivalSweepResult {
  checked: number;
  notified: number;
}

/**
 * Ops action to run the estimated-arrival sweep on demand (ADR 0124): mark
 * recently-posted cards whose estimated arrival has passed as delivered
 * (estimated) and email their buyers a "should have arrived" note. The daily
 * cron does this automatically when enabled; this forces a run and reports the
 * result, so an operator can verify the wiring without a token / curl.
 */
export function ArrivalSweepButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ArrivalSweepResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await clientApiFetch<ArrivalSweepResult>("/fulfillment/notify-arrivals", {
        method: "POST",
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't run the arrival sweep.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Arrival sweep</h2>
      <p className="text-sm text-muted">
        Estimated-arrival emails for stamped post. Standard letters aren&rsquo;t tracked, so a daily
        sweep marks each posted card delivered once its estimated arrival has passed and emails the
        buyer a &ldquo;should have arrived&rdquo; note. Runs automatically each morning when enabled —
        use this to force a run now.
      </p>

      {error && <p className="text-sm font-medium text-accent">{error}</p>}
      {result && (
        <p className="text-sm text-foreground">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Done.</span> Checked{" "}
          {result.checked.toLocaleString("en-GB")} posted card{result.checked === 1 ? "" : "s"};{" "}
          {result.notified.toLocaleString("en-GB")} marked arrived &amp; emailed.
          {result.checked > 0 && result.notified === 0 && (
            <span className="text-muted">
              {" "}
              None were past their estimated arrival yet — try again a working day or so after
              posting.
            </span>
          )}
        </p>
      )}

      <div>
        <button type="button" onClick={() => void run()} disabled={busy} className="btn-accent">
          {busy ? "Running…" : "Run arrival sweep"}
        </button>
      </div>
    </div>
  );
}
