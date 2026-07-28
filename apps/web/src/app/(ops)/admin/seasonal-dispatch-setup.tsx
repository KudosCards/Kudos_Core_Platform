"use client";

import type { SeasonalDispatchRule } from "@kudos/shared-types";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface RulesResponse {
  rules: SeasonalDispatchRule[];
  default: SeasonalDispatchRule[];
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function blankRule(): SeasonalDispatchRule {
  return {
    label: "",
    from: { month: 12, day: 1 },
    to: { month: 12, day: 24 },
    extraLeadDays: 3,
    suggestFirstClass: true,
  };
}

/**
 * Ops-only editor for the seasonal dispatch windows (Christmas rush, …). Each
 * window adds extra working-day lead for occasions dated inside it and can nudge
 * First Class. Saved via the platform API and applied immediately — no redeploy.
 * See docs/adr/0059-configurable-seasonal-dispatch.md.
 */
export function SeasonalDispatchSetup() {
  const [rules, setRules] = useState<SeasonalDispatchRule[] | null>(null);
  const [defaults, setDefaults] = useState<SeasonalDispatchRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    clientApiFetch<RulesResponse>("/admin/dispatch/seasonal-rules")
      .then((r) => {
        if (!active) return;
        setRules(r.rules);
        setDefaults(r.default);
      })
      .catch(() => {
        if (active) setError("Couldn't load seasonal dispatch rules.");
      });
    return () => {
      active = false;
    };
  }, []);

  function update(index: number, patch: Partial<SeasonalDispatchRule>) {
    setSaved(false);
    setRules((current) =>
      (current ?? []).map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  }

  function save(next: SeasonalDispatchRule[]) {
    setBusy(true);
    setError(null);
    clientApiFetch<{ rules: SeasonalDispatchRule[] }>("/admin/dispatch/seasonal-rules", {
      method: "PUT",
      body: JSON.stringify({ rules: next }),
    })
      .then((r) => {
        setRules(r.rules);
        setSaved(true);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not save the windows"))
      .finally(() => setBusy(false));
  }

  const cell = "rounded-md border border-border bg-surface px-2 py-1 text-sm";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
          Seasonal dispatch windows
        </h2>
        {saved && <span className="text-xs font-medium text-emerald-700">Saved</span>}
      </div>
      <p className="text-sm text-muted">
        Occasions dated inside a window get extra working-day lead (so cards go out earlier during the
        post rush), and can nudge senders toward First Class. Applied straight away — no redeploy.
      </p>

      {error && <p className="text-sm font-medium text-accent">{error}</p>}

      {rules === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="text-xs tracking-wide text-muted uppercase">
                  <th className="py-2 pr-3 font-medium">Label</th>
                  <th className="py-2 pr-3 font-medium">From</th>
                  <th className="py-2 pr-3 font-medium">To</th>
                  <th className="py-2 pr-3 font-medium">Extra days</th>
                  <th className="py-2 pr-3 font-medium">1st class</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-3 text-muted">
                      No windows — dispatch uses the standard lead all year.
                    </td>
                  </tr>
                ) : (
                  rules.map((rule, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-2 pr-3">
                        <input
                          value={rule.label}
                          onChange={(e) => update(i, { label: e.target.value })}
                          placeholder="e.g. Christmas post rush"
                          className={`${cell} w-44`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <MonthDay
                          value={rule.from}
                          onChange={(from) => update(i, { from })}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <MonthDay value={rule.to} onChange={(to) => update(i, { to })} />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={rule.extraLeadDays}
                          onChange={(e) =>
                            update(i, { extraLeadDays: Number(e.target.value) || 0 })
                          }
                          className={`${cell} w-16`}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={rule.suggestFirstClass}
                          onChange={(e) => update(i, { suggestFirstClass: e.target.checked })}
                          className="accent-accent"
                        />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setRules(rules.filter((_, j) => j !== i))}
                          className="text-xs text-muted hover:text-accent"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSaved(false);
                setRules([...(rules ?? []), blankRule()]);
              }}
              className="rounded-full border border-border px-3 py-1.5 text-sm font-medium hover:bg-foreground/[0.03]"
            >
              + Add window
            </button>
            <button
              type="button"
              onClick={() => save(rules)}
              disabled={busy}
              className="btn-accent disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save windows"}
            </button>
            <button
              type="button"
              onClick={() => save(defaults)}
              disabled={busy}
              className="text-sm text-muted hover:text-foreground disabled:opacity-40"
            >
              Reset to default
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MonthDay({
  value,
  onChange,
}: {
  value: { month: number; day: number };
  onChange: (v: { month: number; day: number }) => void;
}) {
  const cell = "rounded-md border border-border bg-surface px-2 py-1 text-sm";
  return (
    <span className="flex items-center gap-1">
      <select
        value={value.month}
        onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}
        className={cell}
      >
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        max={31}
        value={value.day}
        onChange={(e) => onChange({ ...value, day: Number(e.target.value) || 1 })}
        className={`${cell} w-14`}
      />
    </span>
  );
}
