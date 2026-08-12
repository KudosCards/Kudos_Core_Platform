"use client";

import type { DispatchReminderConfig } from "@kudos/shared-types";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface ConfigResponse {
  config: DispatchReminderConfig;
  default: DispatchReminderConfig;
}

/** A UTC hour (0–23) shown as "07:00 UTC". */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00 UTC`;
}

/**
 * Ops editor for the send-by-5 dispatch reminder (ADR 0117): whether it runs, the
 * UTC hour it sends, the send-by window, and how overdue a card must be before it
 * escalates to super admins. Saved via the platform API, applied on the next run —
 * no redeploy.
 */
export function DispatchReminderSetup() {
  const [config, setConfig] = useState<DispatchReminderConfig | null>(null);
  const [defaults, setDefaults] = useState<DispatchReminderConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    clientApiFetch<ConfigResponse>("/admin/dispatch/reminder-config")
      .then((r) => {
        if (!active) return;
        setConfig(r.config);
        setDefaults(r.default);
      })
      .catch(() => {
        if (active) setError("Couldn't load the reminder settings.");
      });
    return () => {
      active = false;
    };
  }, []);

  function patch(next: Partial<DispatchReminderConfig>) {
    setSaved(false);
    setConfig((current) => (current ? { ...current, ...next } : current));
  }

  function save(next: DispatchReminderConfig) {
    setBusy(true);
    setError(null);
    clientApiFetch<{ config: DispatchReminderConfig }>("/admin/dispatch/reminder-config", {
      method: "PUT",
      body: JSON.stringify(next),
    })
      .then((r) => {
        setConfig(r.config);
        setSaved(true);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not save the settings"))
      .finally(() => setBusy(false));
  }

  const cell = "rounded-md border border-border bg-surface px-2 py-1 text-sm";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
          Dispatch reminders
        </h2>
        {saved && <span className="text-xs font-medium text-emerald-700">Saved</span>}
      </div>
      <p className="text-sm text-muted">
        The daily &ldquo;cards to post&rdquo; digest to Kudos HQ — email, dashboard and the ops
        bell. Applied on the next run — no redeploy.
      </p>

      {error && <p className="text-sm font-medium text-accent">{error}</p>}

      {config === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
              className="accent-accent"
            />
            <span>Send the daily reminder</span>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs tracking-wide text-muted uppercase">Send time</span>
              <select
                value={config.sendHourUtc}
                onChange={(e) => patch({ sendHourUtc: Number(e.target.value) })}
                className={cell}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs tracking-wide text-muted uppercase">Send-by window</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={config.leadWorkingDays}
                  onChange={(e) => patch({ leadWorkingDays: Number(e.target.value) || 1 })}
                  className={`${cell} w-16`}
                />
                <span className="text-muted">working days</span>
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs tracking-wide text-muted uppercase">Escalate after</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={15}
                  value={config.escalateAfterWorkingDays}
                  onChange={(e) => patch({ escalateAfterWorkingDays: Number(e.target.value) || 0 })}
                  className={`${cell} w-16`}
                />
                <span className="text-muted">wd late (0 = off)</span>
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs tracking-wide text-muted uppercase">Same-day cut-off</span>
              <select
                value={config.sameDayCutoffHour}
                onChange={(e) => patch({ sameDayCutoffHour: Number(e.target.value) })}
                className={cell}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {`${String(h).padStart(2, "0")}:00 UK`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">
            Cards overdue by the escalation threshold get a louder alert to super admins. A
            &ldquo;Send now&rdquo; order placed at or after the same-day cut-off (UK time) posts the
            next working day.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => save(config)}
              disabled={busy}
              className="btn-accent disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
            {defaults && (
              <button
                type="button"
                onClick={() => save(defaults)}
                disabled={busy}
                className="text-sm text-muted hover:text-foreground disabled:opacity-40"
              >
                Reset to default
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
