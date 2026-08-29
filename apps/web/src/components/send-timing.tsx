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
  /** Contacts whose birthday is still ahead but skipped, so it cannot be timed
   * to until it is restored. Told apart from "no birthday at all" because the
   * sender can do something about one and not the other. */
  skipped: number;
}

/**
 * "Mon 21 Sept", or "Fri 11 Jun 2027" when the date is not in the current year.
 *
 * The year matters: a contact list's occasions routinely span twelve months, and
 * without it a range reads backwards — "from Fri 4 Sept to Sat 19 Jun" looks
 * like a mistake rather than a span into next year.
 *
 * Assembled from parts rather than taken from `format` whole, because the full
 * en-GB pattern is not stable across ICU versions and this component renders on
 * the server as well as in the browser: Node 22 (ICU 78) produces "Sun 30 Aug"
 * where Chromium produces "Sun, 30 Aug", which threw a hydration error on every
 * render of this screen. The part names are ICU's; the punctuation is ours.
 */
function formatLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const base = `${part("weekday")} ${part("day")} ${part("month")}`;
  return d.getUTCFullYear() === new Date().getUTCFullYear() ? base : `${base} ${part("year")}`;
}

/** "1 card" / "12 cards". */
function cards(n: number): string {
  return `${n} card${n === 1 ? "" : "s"}`;
}

/**
 * "When should these go?" — the choice at payment between posting everything as
 * soon as possible, timing each card to its own recipient's occasion (offered
 * only when the selection has dated occasions), and posting to arrive on a
 * chosen date. You pay now in all three; the later two just hold the card back
 * until its posting day.
 *
 * Every option leads with **the day cards actually post**, in the same shape, so
 * the three can be compared rather than parsed. That is the fix for a reported
 * confusion: the options were each phrased their own way, one of them said
 * "Send now" above a line explaining it would not go for four days, and the
 * occasion option printed the *occasion* dates in a sentence claiming the cards
 * posted on them — five working days out, and often naming a Saturday, which is
 * never a posting day.
 *
 * Every date here comes from the same working-day engine the API validates
 * against — `computeDispatchDate` over `POSTAGE_LEAD_DAYS`, the same call the
 * send itself makes — so what the customer reads is what they get. See ADR 0130
 * and ADR 0167.
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
      ? isoDay(
          computeDispatchDate(
            new Date(`${selected}T00:00:00.000Z`),
            POSTAGE_LEAD_DAYS[postageClass],
          ),
        )
      : null;

  // When "Send now" actually posts, honouring the same-day cut-off: today if
  // we're on a working day before the cut-off, else the next working day. The
  // API is authoritative; this uses the standard cut-off so the customer sees
  // the real posting day up front rather than an implied "today". See ADR 0160.
  const sendNowPostsOn = isoDay(sendNowDispatchDate());
  const sendNowIsToday = sendNowPostsOn === isoDay(new Date());

  // When an occasion-dated card actually posts. The server computes each card's
  // dispatch date backwards from its occasion by the same working-day lead
  // (batch-orders.service.ts), so this is the real posting day, not a preview of
  // one. It is the whole point of the rewrite: the screen used to print the
  // *occasion* dates in a sentence that said the cards "post" on them, which is
  // five working days out — and named Saturdays, which are never posting days.
  const lead = POSTAGE_LEAD_DAYS[postageClass];
  const postsFor = (iso: string) => {
    const dispatch = isoDay(computeDispatchDate(new Date(`${iso}T00:00:00.000Z`), lead));
    // An occasion closer than the lead computes a dispatch date in the past. The
    // send clamps that (`notBeforeToday`, batch-orders.service.ts) — a card
    // cannot post before the order exists — so floor it here at the same day a
    // post-now card would leave. Without this the picker would promise a date
    // that has already been, which is the class of thing this rewrite exists to
    // stop. ISO dates compare correctly as strings.
    return dispatch < sendNowPostsOn ? sendNowPostsOn : dispatch;
  };
  const firstPost = occasionDating?.earliest ? postsFor(occasionDating.earliest) : null;
  const lastPost = occasionDating?.latest ? postsFor(occasionDating.latest) : null;
  // A single dated card, or several sharing one occasion day, all post together.
  const onePostingDay = firstPost !== null && firstPost === lastPost;
  const undated = occasionDating ? occasionDating.total - occasionDating.count : 0;
  // Of the ones that won't be timed, how many *could* be. A skipped birthday is
  // still on file and can be restored in Approvals; telling the sender they have
  // "no occasion on file" was untrue and hid the only thing they could act on.
  const skippedAhead = Math.min(occasionDating?.skipped ?? 0, undated);
  const noBirthday = undated - skippedAhead;
  // Every option answers the same question in the same shape — "which cards, on
  // what day" — so the three can be compared at a glance instead of each being
  // phrased its own way.
  const together = Boolean(occasionDating && occasionDating.count > 0);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-foreground">
        {occasionDating && occasionDating.total > 1
          ? "When should these cards go?"
          : "When should this go?"}
      </legend>

      {/* Listed first because on a selection that has occasions it is almost
          always the right answer — but never pre-ticked: the choice stays a
          deliberate act (ADR 0159). */}
      {occasionDating && occasionDating.count > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-black/10 p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5">
          <input
            type="radio"
            name={idPrefix}
            className="mt-0.5"
            checked={value?.mode === "occasion"}
            onChange={() => onChange({ mode: "occasion" })}
          />
          <span>
            <span className="font-medium">Each card on its own occasion</span>
            <span className="block text-xs text-muted">
              {onePostingDay ? (
                <>
                  {cards(occasionDating.count)} post{occasionDating.count === 1 ? "s" : ""}{" "}
                  <strong>{formatLong(firstPost)}</strong>, ahead of{" "}
                  {occasionDating.count === 1 ? "its occasion" : "their occasions"} on{" "}
                  {formatLong(occasionDating.earliest!)}.
                </>
              ) : (
                <>
                  {cards(occasionDating.count)} post between{" "}
                  <strong>{formatLong(firstPost!)}</strong> and{" "}
                  <strong>{formatLong(lastPost!)}</strong>, each ahead of its own occasion.
                </>
              )}
              {noBirthday > 0 && (
                <>
                  {" "}
                  {skippedAhead > 0 ? "Another" : "The other"}{" "}
                  {noBirthday === 1 ? "card has" : `${noBirthday} have`} no birthday on file —{" "}
                  {noBirthday === 1 ? "it posts" : "they post"}{" "}
                  <strong>{sendNowIsToday ? "today" : formatLong(sendNowPostsOn)}</strong>.
                </>
              )}
              {skippedAhead > 0 && (
                <>
                  {" "}
                  <strong>
                    {skippedAhead} {skippedAhead === 1 ? "has a birthday" : "have birthdays"} coming
                    up that {skippedAhead === 1 ? "was" : "were"} skipped
                  </strong>
                  , so {skippedAhead === 1 ? "it posts" : "they post"}{" "}
                  {sendNowIsToday ? "today" : formatLong(sendNowPostsOn)} with the rest. Restore{" "}
                  {skippedAhead === 1 ? "it" : "them"} in{" "}
                  <a href="/approvals" className="underline hover:text-foreground">
                    Approvals
                  </a>{" "}
                  first to time {skippedAhead === 1 ? "that card" : "those cards"} properly.
                </>
              )}
            </span>
          </span>
        </label>
      )}

      <label className="flex items-start gap-2 rounded-md border border-black/10 p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5">
        <input
          type="radio"
          name={idPrefix}
          className="mt-0.5"
          checked={value?.mode === "now"}
          onChange={() => onChange({ mode: "now" })}
        />
        <span>
          <span className="font-medium">
            {together ? "All together, as soon as possible" : "As soon as possible"}
          </span>
          <span className="block text-xs text-muted">
            {together ? (
              <>
                All {occasionDating!.total} post{" "}
                <strong>{sendNowIsToday ? "today" : formatLong(sendNowPostsOn)}</strong>
                {sendNowIsToday
                  ? ", as soon as they're printed"
                  : " — today's post has already gone"}
                . Occasion dates are ignored.
              </>
            ) : (
              <>
                {sendNowIsToday ? (
                  <>
                    Posted <strong>today</strong>, as soon as it’s printed.
                  </>
                ) : (
                  <>
                    We post it <strong>{formatLong(sendNowPostsOn)}</strong>
                    {" — today's post has already gone."}
                  </>
                )}
              </>
            )}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 rounded-md border border-black/10 p-2.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5">
        <input
          type="radio"
          name={idPrefix}
          className="mt-0.5"
          checked={value?.mode === "scheduled"}
          onChange={() => onChange({ mode: "scheduled", deliverBy: selected })}
        />
        <span className="flex-1">
          <span className="font-medium">
            {together ? "All together, arriving on a date I choose" : "Arriving on a date I choose"}
          </span>
          <span className="block text-xs text-muted">
            Pick a date — we post {lead} working days ahead so it arrives around then.
            {together && " Occasion dates are ignored."}
          </span>
          {value?.mode === "scheduled" && (
            <span className="mt-2 flex flex-col gap-1">
              <input
                type="date"
                value={selected}
                min={min}
                max={max}
                onChange={(e) => onChange({ mode: "scheduled", deliverBy: e.target.value || min })}
                className="w-fit rounded-md border border-black/15 px-2 py-1 text-sm"
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
