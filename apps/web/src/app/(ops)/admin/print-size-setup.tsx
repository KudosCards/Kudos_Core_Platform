"use client";

import type { CardSize } from "@kudos/shared-types";
import { CARD_SIZES, cardSizeLabel } from "@kudos/shared-types";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface SizeResponse {
  size: CardSize;
  default: CardSize;
}

/**
 * Super-admin editor for the default print card size (ADR 0138). Sets the size
 * the fulfilment print run opens on; the ops team can still switch A5/A6 per run
 * in the print overlay. Saved via the platform API, applied immediately — no
 * redeploy.
 */
export function PrintSizeSetup() {
  const [size, setSize] = useState<CardSize | null>(null);
  const [houseDefault, setHouseDefault] = useState<CardSize | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    clientApiFetch<SizeResponse>("/admin/print/card-size")
      .then((r) => {
        if (!active) return;
        setSize(r.size);
        setHouseDefault(r.default);
      })
      .catch(() => {
        if (active) setError("Couldn't load the print size setting.");
      });
    return () => {
      active = false;
    };
  }, []);

  function save(next: CardSize) {
    setBusy(true);
    setError(null);
    setSaved(false);
    clientApiFetch<{ size: CardSize }>("/admin/print/card-size", {
      method: "PUT",
      body: JSON.stringify({ size: next }),
    })
      .then((r) => {
        setSize(r.size);
        setSaved(true);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not save the setting"))
      .finally(() => setBusy(false));
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Print size</h2>
        {saved && <span className="text-xs font-medium text-emerald-700">Saved</span>}
      </div>
      <p className="text-sm text-muted">
        The card size the fulfilment print run opens on. The ops team can still switch A5/A6 for an
        individual run in the print preview. Applied immediately — no redeploy.
      </p>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}

      {size === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center overflow-hidden rounded-full border border-border"
            role="group"
            aria-label="Default print size"
          >
            {CARD_SIZES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => save(option)}
                disabled={busy}
                aria-pressed={size === option}
                title={cardSizeLabel(option)}
                className={`px-4 py-1.5 text-sm font-medium disabled:opacity-50 ${
                  size === option
                    ? "bg-foreground text-surface"
                    : "bg-surface text-foreground hover:bg-border/40"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <span className="text-sm text-muted">{cardSizeLabel(size)}</span>
          {houseDefault && size !== houseDefault && (
            <span className="text-xs text-muted">House default: {houseDefault}</span>
          )}
        </div>
      )}
    </div>
  );
}
