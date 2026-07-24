"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface SeatPriceStatus {
  priceId: string | null;
  source: "env" | "platform_setting" | "unconfigured";
}

const SOURCE_LABEL: Record<SeatPriceStatus["source"], string> = {
  env: "set via environment variable",
  platform_setting: "provisioned in-app",
  unconfigured: "not set up yet",
};

/**
 * Ops-only control to turn on the £5/mo extra-seat add-on. It calls the running
 * API, which creates the Stripe Price against this deployment's own (live)
 * Stripe account and stores the id — no dashboard, env var, or redeploy. See
 * docs/adr/0037-in-app-price-provisioning.md.
 */
export function SeatBillingSetup() {
  const [status, setStatus] = useState<SeatPriceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    clientApiFetch<SeatPriceStatus>("/admin/billing/seat-price")
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        if (active) setError("Couldn't load seat-billing status.");
      });
    return () => {
      active = false;
    };
  }, []);

  function enable() {
    setBusy(true);
    setError(null);
    clientApiFetch<SeatPriceStatus>("/admin/billing/seat-price", { method: "POST" })
      .then((s) => setStatus(s))
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Could not set up seat billing"),
      )
      .finally(() => setBusy(false));
  }

  const configured = status !== null && status.priceId !== null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Seat billing (£5/mo add-on)</h2>
        {status && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              configured ? "bg-emerald-100 text-emerald-800" : "bg-accent-soft text-accent"
            }`}
          >
            {configured ? "Active" : "Not set up"}
          </span>
        )}
      </div>

      {error && <p className="text-sm font-medium text-accent">{error}</p>}

      {status === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : configured ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted">
            Extra Centre seats are billable — {SOURCE_LABEL[status.source]}.
          </p>
          <code className="w-fit rounded bg-foreground/[0.05] px-2 py-1 text-xs">{status.priceId}</code>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Turn on the £5/month extra-seat charge. This creates the recurring price in Stripe from
            here — no dashboard or redeploy — and switches seat purchasing on immediately.
          </p>
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="btn-accent w-fit disabled:opacity-50"
          >
            {busy ? "Setting up…" : "Enable seat billing"}
          </button>
        </div>
      )}
    </div>
  );
}
