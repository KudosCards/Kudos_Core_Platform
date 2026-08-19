"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface DailySummaryResult {
  day: string;
  orders: { orderNumber: number }[];
  signups: { accountId: string }[];
  cardsPosted: number;
  adminsEmailed: number;
}

/**
 * Ops action to send the daily digest on demand. The 07:30 cron does this every
 * morning; this exists so the wiring can be confirmed — and the email actually
 * looked at — without waiting until tomorrow.
 *
 * It forces, so it sends even after the morning's run. The once-a-day guard is
 * there to stop a re-fired cron double-sending; a person pressing a button is
 * not that, and a button that says "already sent" every afternoon proves
 * nothing. So pressing twice sends twice.
 */
export function DailySummaryButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DailySummaryResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await clientApiFetch<DailySummaryResult>("/admin/daily-summary/run", {
        method: "POST",
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send the daily summary.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Daily summary</h2>
      <p className="text-sm text-muted">
        Yesterday&rsquo;s orders, cards posted and new sign-ups, emailed to every super admin at
        7:30am UK time and recorded in the notification bell. Use this to send it now — handy the
        first time, to check it reaches you.
      </p>

      {error && <p className="text-sm font-medium text-accent">{error}</p>}
      {result && (
        <p className="text-sm text-foreground">
          {result.adminsEmailed > 0 ? (
            <>
              <span className="font-medium text-emerald-700 dark:text-emerald-400">Sent.</span>{" "}
              {result.day}: {result.orders.length} order{result.orders.length === 1 ? "" : "s"},{" "}
              {result.signups.length} sign-up{result.signups.length === 1 ? "" : "s"},{" "}
              {result.cardsPosted.toLocaleString("en-GB")} card
              {result.cardsPosted === 1 ? "" : "s"} posted → {result.adminsEmailed} super admin
              {result.adminsEmailed === 1 ? "" : "s"}.
            </>
          ) : (
            <span className="text-muted">
              Nothing sent — no super admin has an email address on their operator record, so there
              was nobody to send it to. Add one on the Team page and try again.
            </span>
          )}
        </p>
      )}

      <div>
        <button type="button" onClick={() => void run()} disabled={busy} className="btn-accent">
          {busy ? "Sending…" : "Send yesterday's summary"}
        </button>
      </div>
    </div>
  );
}
