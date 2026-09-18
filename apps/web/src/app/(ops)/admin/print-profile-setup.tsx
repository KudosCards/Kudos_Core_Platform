"use client";

import type { BackFooterMode, PrintLayout, PrintProfile } from "@kudos/shared-types";
import {
  BACK_FOOTER_MODES,
  MAX_BORDERLESS_OVERHANG_MM,
  PRINT_LAYOUTS,
  foldedSheetMm,
} from "@kudos/shared-types";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { SuperAdminEditable } from "../ops-role";

interface ProfileResponse {
  profile: PrintProfile;
  default: PrintProfile;
}

const LAYOUT_LABEL: Record<PrintLayout, string> = {
  "folded-sheet": "Folded sheet",
  "face-per-page": "One face per page",
};
const FOOTER_LABEL: Record<BackFooterMode, string> = {
  reserved: "Pre-printed stock",
  print: "We print it",
};

/** The four numbers the calibration sheet produces, as typed. */
interface Readings {
  top: string;
  right: string;
  bottom: string;
  left: string;
}
const EMPTY: Readings = { top: "", right: "", bottom: "", left: "" };
const EDGES: (keyof Readings)[] = ["top", "right", "bottom", "left"];

const num = (value: string): number | null => {
  const parsed = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
};
const round = (mm: number): number => Math.round(mm * 4) / 4;

/**
 * What the calibration sheet's four readings mean, worked out here so nobody has
 * to do it with a pen.
 *
 * The four numbers are two separate faults and the arithmetic that separates
 * them is the whole reason the sheet asks for four (ADR 0251). Reading them by
 * hand is how the first attempt concluded "shift it left and leave the size
 * alone", which would have left 3.25 mm of every design cut off each long edge.
 */
function derive(readings: Readings): {
  overhang: number;
  offsetX: number;
  offsetY: number;
  mismatchMm: number;
} | null {
  const top = num(readings.top);
  const right = num(readings.right);
  const bottom = num(readings.bottom);
  const left = num(readings.left);
  if (top === null || right === null || bottom === null || left === null) return null;

  const overhang = round((left + right) / 2);
  const sheet = foldedSheetMm("A6");
  // A borderless driver enlarges uniformly, so the long-axis figure predicts the
  // short-axis loss. A wide disagreement means a reading is wrong, not that the
  // printer is strange.
  const predictedShort = (sheet.heightMm * ((left + right) / sheet.widthMm)) / 2;
  return {
    overhang,
    offsetX: round((left - right) / 2),
    offsetY: round((top - bottom) / 2),
    mismatchMm: Math.abs(predictedShort - (top + bottom) / 2),
  };
}

/**
 * Super-admin editor for the print profile (ADR 0249, ADR 0251): the sheet the
 * printer takes, how much its borderless pass enlarges by, where it places the
 * paper, and whether the back's strip is already on the stock.
 *
 * This describes the *printer*, not a run — ops choose a card size per run, but
 * not a different printer per run. Saved via the platform API and applied to the
 * next print run; no redeploy.
 */
export function PrintProfileSetup() {
  const [profile, setProfile] = useState<PrintProfile | null>(null);
  const [houseDefault, setHouseDefault] = useState<PrintProfile | null>(null);
  const [readings, setReadings] = useState<Readings>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    clientApiFetch<ProfileResponse>("/admin/print/profile")
      .then((r) => {
        if (!active) return;
        setProfile(r.profile);
        setHouseDefault(r.default);
      })
      .catch(() => {
        if (active) setError("Couldn't load the print profile.");
      });
    return () => {
      active = false;
    };
  }, []);

  function save(next: PrintProfile) {
    setBusy(true);
    setError(null);
    setSaved(false);
    clientApiFetch<{ profile: PrintProfile }>("/admin/print/profile", {
      method: "PUT",
      body: JSON.stringify(next),
    })
      .then((r) => {
        setProfile(r.profile);
        setSaved(true);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not save the profile"))
      .finally(() => setBusy(false));
  }

  const derived = derive(readings);
  const uncalibrated =
    profile !== null &&
    profile.borderlessOverhangMm === 0 &&
    profile.borderlessOffsetXMm === 0 &&
    profile.borderlessOffsetYMm === 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-medium tracking-wide text-muted uppercase">Print setup</h2>
        {saved && <span className="text-xs font-medium text-emerald-700">Saved</span>}
      </div>
      <p className="text-sm text-muted">
        The printer itself: the sheet it takes, how much its borderless pass enlarges by, and where
        it puts the paper. Applied to the next print run — no redeploy.
      </p>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}

      <SuperAdminEditable>
        {profile === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <div className="flex flex-col gap-6">
            <Toggle
              label="Layout"
              hint="Folded sheet is what this printer needs: two faces on one A5 landscape sheet that folds into a card. One face per page is the fallback."
              options={PRINT_LAYOUTS}
              value={profile.layout}
              render={(option) => LAYOUT_LABEL[option]}
              disabled={busy}
              onChange={(layout) => save({ ...profile, layout })}
            />

            <Toggle
              label="Back footer"
              hint="Whether the Kudos strip across the bottom of the back is already on the stock, or we draw it. Getting this wrong overprints the branding or posts a card with an empty strip."
              options={BACK_FOOTER_MODES}
              value={profile.backFooter}
              render={(option) => FOOTER_LABEL[option]}
              disabled={busy}
              onChange={(backFooter) => save({ ...profile, backFooter })}
            />

            <div className="flex flex-col gap-3 border-t border-border pt-5">
              <h3 className="text-sm font-medium text-foreground">Borderless calibration</h3>
              <p className="text-sm text-muted">
                From the calibration sheet (<code>pnpm --filter @kudos/api calibration-sheet</code>
                ). Print it A5 <strong>landscape</strong> borderless at 100%, check there is no
                white paper outside the grey band, then read the shallowest visible step at the
                middle of each edge.
              </p>

              <div className="flex flex-wrap items-end gap-3">
                {EDGES.map((edge) => (
                  <label key={edge} className="flex flex-col gap-1">
                    <span className="text-xs text-muted capitalize">{edge} (mm)</span>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      max={MAX_BORDERLESS_OVERHANG_MM}
                      value={readings[edge]}
                      onChange={(e) => setReadings({ ...readings, [edge]: e.target.value })}
                      className="w-24 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
                    />
                  </label>
                ))}
              </div>

              {derived && (
                <div className="flex flex-col gap-2 rounded-lg bg-border/20 p-3 text-sm">
                  <p className="text-foreground">
                    Enlargement <strong>{derived.overhang} mm</strong> per long edge · sideways{" "}
                    <strong>{derived.offsetX} mm</strong> · vertical{" "}
                    <strong>{derived.offsetY} mm</strong>
                  </p>
                  <p className="text-muted">
                    Two different faults: the enlargement is the driver blowing the page up, which a
                    resize corrects. The offset is the paper arriving somewhere else, which no
                    resize can correct. Both, or neither — either one alone makes a worse card.
                  </p>
                  {derived.mismatchMm > 0.75 && (
                    <p className="font-medium text-danger">
                      The short edges lose {derived.mismatchMm.toFixed(1)} mm more or less than this
                      enlargement predicts. A borderless pass enlarges evenly, so one of the four
                      readings is probably misread — worth checking before saving.
                    </p>
                  )}
                  <div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        save({
                          ...profile,
                          borderlessOverhangMm: derived.overhang,
                          borderlessOffsetXMm: derived.offsetX,
                          borderlessOffsetYMm: derived.offsetY,
                        })
                      }
                      className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
                    >
                      Save these settings
                    </button>
                  </div>
                </div>
              )}

              <p className="text-sm text-muted">
                In force now: enlargement <strong>{profile.borderlessOverhangMm} mm</strong>,
                sideways <strong>{profile.borderlessOffsetXMm} mm</strong>, vertical{" "}
                <strong>{profile.borderlessOffsetYMm} mm</strong>
                {uncalibrated && " — nothing measured yet, so cards print full size."}
              </p>
              {houseDefault && !uncalibrated && (
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setReadings(EMPTY);
                      save({
                        ...profile,
                        borderlessOverhangMm: houseDefault.borderlessOverhangMm,
                        borderlessOffsetXMm: houseDefault.borderlessOffsetXMm,
                        borderlessOffsetYMm: houseDefault.borderlessOffsetYMm,
                      });
                    }}
                    className="text-xs text-muted underline underline-offset-2"
                  >
                    Clear the calibration
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </SuperAdminEditable>
    </div>
  );
}

/** A labelled two-or-more option switch, matching the print-size control. */
function Toggle<T extends string>({
  label,
  hint,
  options,
  value,
  render,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  options: readonly T[];
  value: T;
  render: (option: T) => string;
  disabled: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <p className="text-sm text-muted">{hint}</p>
      <div
        className="flex w-fit items-center overflow-hidden rounded-full border border-border"
        role="group"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            disabled={disabled}
            aria-pressed={value === option}
            className={`px-4 py-1.5 text-sm font-medium disabled:opacity-50 ${
              value === option
                ? "bg-foreground text-surface"
                : "bg-surface text-foreground hover:bg-border/40"
            }`}
          >
            {render(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
