"use client";

import { useState } from "react";
import {
  AUTO_TOP_UP_AMOUNT_MAX_MINOR,
  AUTO_TOP_UP_AMOUNT_MIN_MINOR,
  AUTO_TOP_UP_THRESHOLD_MAX_MINOR,
  AUTO_TOP_UP_THRESHOLD_MIN_MINOR,
  type AutoTopUpSettings,
  type WalletSummary,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/**
 * Why we stopped, in the customer's language.
 *
 * A `Record` keyed on the code rather than a lookup with a fallback, so the API
 * gaining a pause reason fails the build here until somebody decides what a
 * customer should read — the same rule the ledger labels above follow. The
 * `?? UNKNOWN_PAUSE` below covers only the value arriving from an API that is
 * ahead of this deploy.
 */
const PAUSE_REASONS: Record<string, string> = {
  no_payment_method: "We do not have a card on file we can charge.",
  card_declined: "Your card was declined.",
  authentication_required:
    "Your bank wanted to check the payment with you, and we could not do that on your behalf.",
  unknown: "Something went wrong taking the payment.",
};

const UNKNOWN_PAUSE = "Something went wrong taking the payment.";

function poundsOf(minor: number): string {
  return (minor / 100).toFixed(2).replace(/\.00$/, "");
}

function minorOf(pounds: string): number | null {
  const value = Number(pounds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/**
 * The standing instruction to keep the wallet funded.
 *
 * Set whole — the switch and both numbers save together — because turning it on
 * without saying what it will charge is not a decision anybody made. Saving
 * also resumes a paused instruction, which is exactly what somebody is here to
 * do after fixing their card.
 */
export function AutoTopUpCard({
  settings,
  onSaved,
}: {
  settings: AutoTopUpSettings;
  onSaved: (summary: WalletSummary) => void;
}) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [threshold, setThreshold] = useState(poundsOf(settings.thresholdMinor));
  const [amount, setAmount] = useState(poundsOf(settings.amountMinor));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setError(null);
    setSaved(false);
    const thresholdMinor = minorOf(threshold);
    const amountMinor = minorOf(amount);
    if (thresholdMinor === null || amountMinor === null) {
      setError("Enter both amounts in pounds");
      return;
    }
    if (
      thresholdMinor < AUTO_TOP_UP_THRESHOLD_MIN_MINOR ||
      thresholdMinor > AUTO_TOP_UP_THRESHOLD_MAX_MINOR
    ) {
      setError("Top up when the balance is between £1 and £200");
      return;
    }
    if (amountMinor < AUTO_TOP_UP_AMOUNT_MIN_MINOR || amountMinor > AUTO_TOP_UP_AMOUNT_MAX_MINOR) {
      setError("Each top-up must be between £5 and £1,000");
      return;
    }

    setSaving(true);
    try {
      const next = await clientApiFetch<WalletSummary>("/wallet/auto-top-up", {
        method: "PATCH",
        body: JSON.stringify({ enabled, thresholdMinor, amountMinor }),
      });
      onSaved(next);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Keep my balance topped up</h2>
        <p className="text-sm text-muted">
          We top your wallet up from the card you already pay with, so cards keep going out without
          you having to think about it.
        </p>
      </div>

      {settings.pausedAt && (
        <p className="notice notice-warning">
          <strong>Automatic top-up has stopped.</strong>{" "}
          {PAUSE_REASONS[settings.pausedReason ?? "unknown"] ?? UNKNOWN_PAUSE} Save below to switch
          it back on once that is sorted.
        </p>
      )}

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4 accent-accent"
        />
        <span className="font-medium">Top my wallet up automatically</span>
      </label>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">When the balance drops below</span>
          <div className="flex items-center rounded-md border border-border bg-surface px-3">
            <span className="text-sm text-muted">£</span>
            <input
              type="number"
              min="1"
              max="200"
              step="1"
              value={threshold}
              disabled={!enabled}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-24 bg-transparent px-2 py-2 text-sm outline-none disabled:opacity-50"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Add</span>
          <div className="flex items-center rounded-md border border-border bg-surface px-3">
            <span className="text-sm text-muted">£</span>
            <input
              type="number"
              min="5"
              max="1000"
              step="1"
              value={amount}
              disabled={!enabled}
              onChange={(e) => setAmount(e.target.value)}
              className="w-24 bg-transparent px-2 py-2 text-sm outline-none disabled:opacity-50"
            />
          </div>
        </label>
        <button type="button" onClick={() => void save()} disabled={saving} className="btn-accent">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}
      {saved && !error && (
        <p className="text-sm text-success">
          Saved. {enabled ? "We will keep an eye on your balance." : "Automatic top-up is off."}
        </p>
      )}

      <p className="text-xs text-muted">
        A top-up is a floor, not a promise to cover everything — if your approved cards come to more
        than a top-up adds, we will tell you before any of them is due.
      </p>
    </div>
  );
}
