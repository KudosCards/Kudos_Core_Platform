"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface SchedulerResult {
  recipients: number;
  keyDates: number;
  promoted: number;
}

const N = (value: number) => value.toLocaleString("en-GB");

/**
 * Ops action to run the recurring occasion scheduler on demand.
 *
 * The 06:00 cron moves birthdays that have entered the 21-day window from the
 * calendar into Approvals. Adding contacts does the same for that account
 * straight away — but only on a write, so an account that imported yesterday
 * and hasn't touched anything since sits with a full calendar and an empty
 * Approvals page until morning. This is how that gets repaired today.
 *
 * Safe to press twice: both halves converge on a re-run, so a second press
 * promotes nothing and reports zero rather than doing anything again.
 */
export function OccasionSchedulerButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SchedulerResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await clientApiFetch<SchedulerResult>("/admin/occasions/scheduler/run", {
        method: "POST",
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't run the occasion scheduler.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Occasion scheduler</h2>
      <p className="text-sm text-muted">
        Moves birthdays and key dates that have come within 21 days out of the calendar and into
        Approvals, across every account. Runs by itself at 6am. Use this when a customer says their
        Approvals page is empty but their calendar isn&rsquo;t — it brings the morning&rsquo;s run
        forward. Safe to press more than once.
      </p>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      {result && (
        <p className="text-sm text-foreground">
          {result.promoted > 0 ? (
            <>
              <span className="font-medium text-emerald-700">Done.</span> {N(result.promoted)}{" "}
              occasion{result.promoted === 1 ? "" : "s"} moved into Approvals, from{" "}
              {N(result.recipients)} contact{result.recipients === 1 ? "" : "s"} with a date of
              birth and {N(result.keyDates)} key date{result.keyDates === 1 ? "" : "s"}.
            </>
          ) : (
            <span className="text-muted">
              Nothing to move — every occasion inside the 21-day window is already in Approvals.
              Checked {N(result.recipients)} contact{result.recipients === 1 ? "" : "s"} with a date
              of birth and {N(result.keyDates)} key date{result.keyDates === 1 ? "" : "s"}.
            </span>
          )}
        </p>
      )}

      <div>
        <button type="button" onClick={() => void run()} disabled={busy} className="btn-accent">
          {busy ? "Running…" : "Run the scheduler now"}
        </button>
      </div>
    </div>
  );
}
