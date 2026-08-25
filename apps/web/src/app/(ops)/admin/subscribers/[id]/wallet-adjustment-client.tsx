"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/** Amounts that cover most goodwill gestures without typing. Pence. */
const PRESETS_MINOR = [500, 1000, 2500];

function gbp(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  return `${sign}£${(Math.abs(minor) / 100).toFixed(2)}`;
}

/**
 * Credit a customer's wallet by hand — a goodwill gesture for an engaged
 * customer, instead of issuing a discount code.
 *
 * Deliberately a little deliberate: the amount has to be chosen, the reason
 * typed, and the summary read back before the button does anything. This moves
 * real money onto an account with no payment behind it, and unlike a discount
 * code it takes effect immediately.
 */
export function WalletAdjustment({
  accountId,
  customerName,
  balanceMinor,
}: {
  accountId: string;
  customerName: string;
  balanceMinor: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pounds, setPounds] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const parsed = Number.parseFloat(pounds);
  const magnitude = Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  const amountMinor = direction === "debit" ? -magnitude : magnitude;
  // Mirrors the server's rules so the button doesn't offer something that will
  // only come back as a 400 or 409.
  const overdraws = balanceMinor + amountMinor < 0;
  const valid =
    magnitude > 0 && magnitude <= 100_000 && reason.trim().length >= 4 && !overdraws;

  async function apply() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await clientApiFetch(`/admin/customers/${accountId}/wallet-adjustment`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor,
          reason: reason.trim(),
          // One id per attempt, so a double-click or a retried request credits
          // once. A duplicate credit is nobody's idea of a goodwill gesture.
          requestId: crypto.randomUUID(),
        }),
      });
      setDone(
        `${direction === "credit" ? "Credited" : "Debited"} ${gbp(magnitude)} — ${customerName}'s balance is now ${gbp(balanceMinor + amountMinor)}.`,
      );
      setPounds("");
      setReason("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not apply that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3 flex flex-col gap-2">
        {done && (
          <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
            {done}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone(null);
          }}
          className="w-fit rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/5"
        >
          Adjust wallet balance
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center overflow-hidden rounded-full border border-border" role="group" aria-label="Direction">
        {(
          [
            ["credit", "Credit"],
            ["debit", "Take back"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setDirection(value)}
            aria-pressed={direction === value}
            className={`px-3 py-1 text-xs font-medium ${
              direction === value ? "bg-foreground text-background" : "hover:bg-foreground/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS_MINOR.map((minor) => (
          <button
            key={minor}
            type="button"
            onClick={() => setPounds((minor / 100).toFixed(2))}
            className="rounded-full border border-border px-3 py-1 text-xs hover:bg-foreground/5"
          >
            {gbp(minor)}
          </button>
        ))}
        <label className="flex items-center gap-1 text-xs text-muted">
          £
          <input
            type="number"
            min="0.01"
            max="1000"
            step="0.01"
            value={pounds}
            onChange={(e) => setPounds(e.target.value)}
            placeholder="0.00"
            className="w-24 rounded-md border border-border px-2 py-1 text-sm text-foreground"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted">
        Reason (recorded against your name)
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="e.g. Goodwill — long-standing customer"
          className="rounded-md border border-border px-2 py-1 text-sm text-foreground"
        />
      </label>

      {magnitude > 0 && (
        <p className="text-xs text-muted">
          {direction === "credit" ? "Adds" : "Takes"} <strong>{gbp(magnitude)}</strong>
          {direction === "credit" ? " to " : " from "}
          {customerName}. New balance{" "}
          <strong>{gbp(balanceMinor + amountMinor)}</strong>. Takes effect immediately, and there is
          no VAT invoice behind it — this is a goodwill credit, not a sale.
        </p>
      )}
      {overdraws && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          That is more than the balance. A wallet cannot go below zero.
        </p>
      )}
      {magnitude > 100_000 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">£1,000 is the most in one go.</p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void apply()}
          className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          {busy ? "Applying…" : direction === "credit" ? "Credit wallet" : "Take it back"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-foreground/5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
