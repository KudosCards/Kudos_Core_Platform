"use client";

import type { PostageClass } from "@kudos/shared-types";
import {
  POSTAGE_LEAD_DAYS,
  computeDispatchDate,
  deliverByWindow,
  isoDay,
  sendNowDispatchDate,
} from "@kudos/shared-types";

/**
 * The sender's send-timing choice: post everything now, time each card to its
 * own recipient's occasion, or schedule the lot to arrive on a chosen date.
 * `deliverBy` is an ISO `YYYY-MM-DD` arrive-by date.
 *
 * `occasion` exists because "Send now" was being asked to mean two incompatible
 * things once occasion dating became the default (ADR 0167): a birthday send and
 * a same-day campaign are both "now" to the sender, and only one of them should
 * post today. No wording fixes that — it needed a third answer.
 */
export type SendTiming =
  { mode: "now" } | { mode: "occasion" } | { mode: "scheduled"; deliverBy: string };

/** The value passed to the order API: undefined unless a date was chosen, else
 * the arrive-by date. Keeps callers from reaching into the union. */
export function timingDeliverBy(timing: SendTiming): string | undefined {
  return timing.mode === "scheduled" ? timing.deliverBy : undefined;
}

/** What a selection's occasion dating would do, as the preflight reports it,
 * plus how many cards are in the send so the copy can say "N of M". */
export interface OccasionDatingSummary {
  count: number;
  total: number;
  earliest: string | null;
  latest: string | null;
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
 * "When should this go?" — the choice at payment between **Send now**,
 * **Schedule delivery**, and (where the selection has dated occasions to time
 * to) **each card on its own occasion**. You pay now either way; scheduling
 * just holds the card until it's posted to arrive around the chosen date. The picker's range and the
 * "posts on…" line are computed from the same working-days lead engine the API
 * validates against, so what the customer sees is what they get. See ADR 0130.
 */
export function SendTimingPicker({
  postageClass,
  value,
  onChange,
  idPrefix = "send-timing",
  occasionDating,
}: {
  postageClass: PostageClass;
  // Null = no choice made yet. This is deliberately unselected by default so a
  // sender can't absent-mindedly leave "Send now" as a pre-ticked default —
  // callers make the choice a required gate before paying. See ADR 0159.
  value: SendTiming | null;
  onChange: (next: SendTiming) => void;
  idPrefix?: string;
  /**
   * The occasion-dating option, offered only when this selection actually has
   * dated occasions to time to — an option that would do nothing is worse than
   * no option, and the single-card send has no matching at all, so it simply
   * doesn't pass this. Null / zero count = the two original choices, unchanged.
   */
  occasionDating?: OccasionDatingSummary | null;
}) {
  const { earliest, latest } = deliverByWindow(postageClass);
  const min = isoDay(earliest);
  const max = isoDay(latest);
  const selected = value?.mode === "scheduled" ? value.deliverBy : min;

  const postsOn =
    value?.mode === "scheduled"
      ? isoDay(computeDispatchDate(new Date(`${selected}T00:00:00.000Z`), POSTAGE_LEAD_DAYS[postageClass]))
      : null;

  // When "Send now" actually posts, honouring the same-day cut-off: today if
  // we're on a working day before the cut-off, else the next working day. The
  // API is authoritative; this uses the standard cut-off so the customer sees
  // the real posting day up front rather than an implied "today". See ADR 0160.
  const sendNowPostsOn = isoDay(sendNowDispatchDate());
  const sendNowIsToday = sendNowPostsOn === isoDay(new Date());

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-foreground">When should this go?</legend>

      {/* Listed first because on a selection that has occasions it is almost
          always the right answer — but never pre-ticked: the choice stays a
          deliberate act (ADR 0159). */}
      {occasionDating && occasionDating.count > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-black/10 p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5 dark:border-white/10">
          <input
            type="radio"
            name={idPrefix}
            className="mt-0.5"
            checked={value?.mode === "occasion"}
            onChange={() => onChange({ mode: "occasion" })}
          />
          <span>
            <span className="font-medium">Time each card to its own occasion</span>
            <span className="block text-xs text-muted">
              <strong>
                {occasionDating.count} of {occasionDating.total}
              </strong>{" "}
              cards post ahead of that person&apos;s own occasion
              {occasionDating.earliest && occasionDating.latest && (
                <>
                  , spread from <strong>{formatLong(occasionDating.earliest)}</strong> to{" "}
                  <strong>{formatLong(occasionDating.latest)}</strong>
                </>
              )}
              .
              {occasionDating.count < occasionDating.total && (
                <>
                  {" "}
                  The other {occasionDating.total - occasionDating.count} have no occasion on file
                  and post {sendNowIsToday ? "today" : formatLong(sendNowPostsOn)}.
                </>
              )}
            </span>
          </span>
        </label>
      )}

      <label className="flex items-start gap-2 rounded-md border border-black/10 p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5 dark:border-white/10">
        <input
          type="radio"
          name={idPrefix}
          className="mt-0.5"
          checked={value?.mode === "now"}
          onChange={() => onChange({ mode: "now" })}
        />
        <span>
          <span className="font-medium">
            Send now{occasionDating && occasionDating.count > 0 ? " — one date for everyone" : ""}
          </span>
          <span className="block text-xs text-muted">
            {sendNowIsToday ? (
              <>Posted today, as soon as it&apos;s printed.</>
            ) : (
              <>
                Today&apos;s post has gone — we post it <strong>{formatLong(sendNowPostsOn)}</strong>.
              </>
            )}
            {occasionDating && occasionDating.count > 0 && (
              <>
                {" "}
                Occasion dates are ignored — every card goes together.
              </>
            )}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 rounded-md border border-black/10 p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5 dark:border-white/10">
        <input
          type="radio"
          name={idPrefix}
          className="mt-0.5"
          checked={value?.mode === "scheduled"}
          onChange={() => onChange({ mode: "scheduled", deliverBy: selected })}
        />
        <span className="flex-1">
          <span className="font-medium">Schedule delivery</span>
          <span className="block text-xs text-muted">
            Pay now — we post it timed to arrive around your date.
          </span>
          {value?.mode === "scheduled" && (
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
