"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface BackfillSummary {
  scanned: number;
  recorded: number;
  notSubscription: number;
  unmatched: number;
  truncated: boolean;
}

/**
 * Ops action to replay Stripe's paid-invoice history into our subscription
 * income records.
 *
 * Needed once, because capture only began when the webhook learned to keep
 * these — everything billed before that was discarded — and useful afterwards
 * to repair a gap left by a missed webhook. Until it has been run, the spend
 * figures on a customer's page only cover invoices paid since capture started.
 *
 * Safe to press more than once: every write is keyed on Stripe's invoice id, so
 * a second run updates the same rows rather than double-counting.
 */
export function SubscriptionBackfillButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BackfillSummary | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const summary = await clientApiFetch<BackfillSummary>(
        "/admin/subscription-invoices/backfill",
        { method: "POST" },
      );
      setResult(summary);
    } catch (backfillError) {
      setError(
        backfillError instanceof ApiError
          ? backfillError.message
          : "Couldn't read the invoice history from Stripe.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
        Subscription income
      </h2>
      <p className="text-sm text-muted">
        Reads every paid invoice from Stripe and records the subscription ones, so each
        customer&rsquo;s page shows what they have actually paid us. Run it once to import the
        history, and again any time you suspect a payment was missed — repeat runs can&rsquo;t
        double-count.
      </p>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}
      {result && (
        <div className="flex flex-col gap-1 text-sm text-foreground">
          <p>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">Done.</span>{" "}
            Recorded {result.recorded.toLocaleString("en-GB")} subscription invoice
            {result.recorded === 1 ? "" : "s"} from {result.scanned.toLocaleString("en-GB")} paid
            invoice{result.scanned === 1 ? "" : "s"} in Stripe.
          </p>
          {result.notSubscription > 0 && (
            <p className="text-xs text-muted">
              {result.notSubscription.toLocaleString("en-GB")} weren&rsquo;t subscription invoices
              (card orders and one-offs) and were left alone.
            </p>
          )}
          {result.unmatched > 0 && (
            <p className="text-xs text-amber-600">
              {result.unmatched.toLocaleString("en-GB")} couldn&rsquo;t be matched to an account —
              that income is missing from someone&rsquo;s record. Check the API logs for the invoice
              ids.
            </p>
          )}
          {result.truncated && (
            <p className="text-xs text-amber-600">
              Stopped at the page limit with more history left in Stripe. A repeat run starts from
              the newest invoice again, so it would stop in the same place — the limit needs raising
              in the API before the rest can be imported.
            </p>
          )}
        </div>
      )}

      <div>
        <button type="button" onClick={() => void run()} disabled={busy} className="btn-accent">
          {busy ? "Importing…" : "Import subscription history"}
        </button>
      </div>
    </div>
  );
}
