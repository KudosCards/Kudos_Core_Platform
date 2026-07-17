"use client";

import { useState } from "react";
import type { WalletEntryType, WalletSummary } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/** Preset top-up amounts in pence, plus a custom field. */
const PRESETS_MINOR = [1000, 2500, 5000];

const ENTRY_LABELS: Record<WalletEntryType, string> = {
  topup: "Top-up",
  charge: "Order payment",
  refund: "Refund",
  adjustment: "Adjustment",
};

function formatGbp(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  return `${sign}£${(Math.abs(minor) / 100).toFixed(2)}`;
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function WalletClient({
  initialSummary,
  topupStatus,
}: {
  initialSummary: WalletSummary;
  topupStatus: string | null;
}) {
  const [customPounds, setCustomPounds] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);

  async function topUp(amountMinor: number) {
    setError(null);
    setPendingAmount(amountMinor);
    try {
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>("/wallet/top-up", {
        method: "POST",
        body: JSON.stringify({ amountMinor }),
      });
      window.location.assign(checkoutUrl);
    } catch (topUpError) {
      setError(topUpError instanceof ApiError ? topUpError.message : "Could not start top-up");
      setPendingAmount(null);
    }
  }

  function topUpCustom() {
    const pounds = Number(customPounds);
    if (!Number.isFinite(pounds) || pounds <= 0) {
      setError("Enter a top-up amount in pounds");
      return;
    }
    const amountMinor = Math.round(pounds * 100);
    if (amountMinor < 100 || amountMinor > 100_000) {
      setError("Top-ups must be between £1 and £1,000");
      return;
    }
    void topUp(amountMinor);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Wallet</h1>
        <p className="text-foreground/60">
          Top up your balance to pay for card orders instantly, without a card payment each time.
        </p>
      </div>

      {topupStatus === "success" && (
        <p className="rounded-md border border-green-600/30 bg-green-600/5 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          Payment received — your balance updates within a few moments of Stripe confirming it.
          Refresh if you don&apos;t see it yet.
        </p>
      )}
      {topupStatus === "cancelled" && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-foreground/70">
          Top-up cancelled — no payment was taken.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded-lg border border-black/10 p-6 dark:border-white/10">
        <p className="text-sm text-foreground/60">Current balance</p>
        <p className="text-4xl font-semibold">{formatGbp(initialSummary.balanceMinor)}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">Add funds</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS_MINOR.map((amountMinor) => (
            <button
              key={amountMinor}
              type="button"
              disabled={pendingAmount !== null}
              onClick={() => void topUp(amountMinor)}
              className="rounded-full bg-foreground px-5 py-2 text-sm text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pendingAmount === amountMinor ? "Redirecting…" : `Add ${formatGbp(amountMinor)}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-black/10 px-3 dark:border-white/10">
            <span className="text-sm text-foreground/60">£</span>
            <input
              type="number"
              min="1"
              max="1000"
              step="0.01"
              placeholder="Other amount"
              value={customPounds}
              onChange={(e) => setCustomPounds(e.target.value)}
              className="w-32 bg-transparent px-2 py-2 text-sm outline-none"
            />
          </div>
          <button
            type="button"
            disabled={pendingAmount !== null}
            onClick={topUpCustom}
            className="rounded-full border border-black/20 px-5 py-2 text-sm hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
          >
            Add funds
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">Recent activity</h2>
        {initialSummary.entries.length === 0 ? (
          <p className="text-sm text-foreground/60">No wallet activity yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
            {initialSummary.entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{ENTRY_LABELS[entry.type]}</span>
                  <span className="text-xs text-foreground/50">{formatDate(entry.createdAt)}</span>
                </div>
                <span
                  className={
                    entry.amountMinor < 0
                      ? "font-medium text-foreground"
                      : "font-medium text-green-700 dark:text-green-400"
                  }
                >
                  {entry.amountMinor > 0 ? "+" : ""}
                  {formatGbp(entry.amountMinor)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
