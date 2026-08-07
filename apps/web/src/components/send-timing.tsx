"use client";

import type { PostageClass } from "@kudos/shared-types";
import {
  POSTAGE_LEAD_DAYS,
  computeDispatchDate,
  deliverByWindow,
  isoDay,
} from "@kudos/shared-types";

/** The sender's send-timing choice: post it now, or schedule it to arrive on a
 * chosen date. `deliverBy` is an ISO `YYYY-MM-DD` arrive-by date. */
export type SendTiming = { mode: "now" } | { mode: "scheduled"; deliverBy: string };

/** The value passed to the order API: undefined for "send now", else the
 * arrive-by date. Keeps callers from reaching into the union. */
export function timingDeliverBy(timing: SendTiming): string | undefined {
  return timing.mode === "scheduled" ? timing.deliverBy : undefined;
}

function formatLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

/**
 * "When should this go?" — the shared choice at payment between **Send now** and
 * **Schedule delivery**. You pay now either way; scheduling just holds the card
 * until it's posted to arrive around the chosen date. The picker's range and the
 * "posts on…" line are computed from the same working-days lead engine the API
 * validates against, so what the customer sees is what they get. See ADR 0130.
 */
export function SendTimingPicker({
  postageClass,
  value,
  onChange,
  idPrefix = "send-timing",
}: {
  postageClass: PostageClass;
  value: SendTiming;
  onChange: (next: SendTiming) => void;
  idPrefix?: string;
}) {
  const { earliest, latest } = deliverByWindow(postageClass);
  const min = isoDay(earliest);
  const max = isoDay(latest);
  const selected = value.mode === "scheduled" ? value.deliverBy : min;

  const postsOn =
    value.mode === "scheduled"
      ? isoDay(computeDispatchDate(new Date(`${selected}T00:00:00.000Z`), POSTAGE_LEAD_DAYS[postageClass]))
      : null;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-foreground">When should this go?</legend>

      <label className="flex items-start gap-2 rounded-md border border-black/10 p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5 dark:border-white/10">
        <input
          type="radio"
          name={idPrefix}
          className="mt-0.5"
          checked={value.mode === "now"}
          onChange={() => onChange({ mode: "now" })}
        />
        <span>
          <span className="font-medium">Send now</span>
          <span className="block text-xs text-muted">Posted as soon as it&apos;s printed.</span>
        </span>
      </label>

      <label className="flex items-start gap-2 rounded-md border border-black/10 p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5 dark:border-white/10">
        <input
          type="radio"
          name={idPrefix}
          className="mt-0.5"
          checked={value.mode === "scheduled"}
          onChange={() => onChange({ mode: "scheduled", deliverBy: selected })}
        />
        <span className="flex-1">
          <span className="font-medium">Schedule delivery</span>
          <span className="block text-xs text-muted">
            Pay now — we post it timed to arrive around your date.
          </span>
          {value.mode === "scheduled" && (
            <span className="mt-2 flex flex-col gap-1">
              <input
                type="date"
                value={selected}
                min={min}
                max={max}
                onChange={(e) =>
                  onChange({ mode: "scheduled", deliverBy: e.target.value || min })
                }
                className="w-fit rounded-md border border-black/15 px-2 py-1 text-sm dark:border-white/15"
              />
              {postsOn && (
                <span className="text-xs text-muted">
                  Arrives around <strong>{formatLong(selected)}</strong> · we post it{" "}
                  {formatLong(postsOn)}.
                </span>
              )}
            </span>
          )}
        </span>
      </label>
    </fieldset>
  );
}
