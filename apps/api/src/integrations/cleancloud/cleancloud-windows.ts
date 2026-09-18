/**
 * How a CleanCloud pull is cut into requests.
 *
 * `getCustomer` filters by the customer's **creation** date and accepts a range
 * of at most 31 days. There is no last-modified filter, so there is no such
 * thing as an incremental sync here: a customer who changed address today would
 * never appear in a "since yesterday" window. The answer is to stop trying and
 * re-walk the whole history every night — at 31 days a request, a decade is
 * about 118 of them, which is nothing for a nightly job and makes address
 * edits and deactivations actually propagate. See ADR 0252.
 *
 * Windows come back **newest first**. That only matters when a pull stops early
 * — and then it matters a lot: whoever signed up most recently is who the
 * customer is most likely to be looking for, and a partial import holding the
 * oldest tenth of the list would look like the integration simply lost people.
 */

/** CleanCloud's documented maximum range for a `getCustomer` date query. */
export const CLEANCLOUD_WINDOW_DAYS = 31;

/** How far back a full re-walk goes. Ten years is past the life of almost any
 * high-street dry cleaner's customer file, and costs ~118 requests. */
export const CLEANCLOUD_HISTORY_YEARS = 10;

/**
 * Safety bound on the number of requests one pull may make, whatever the
 * horizon works out to. It is a real limit, not a formality: stopping at it
 * imports partially, and `truncated` is what makes that visible.
 */
export const CLEANCLOUD_MAX_WINDOWS = 130;

export interface DateWindow {
  from: Date;
  to: Date;
}

export interface WindowPlan {
  /** Newest first. */
  windows: DateWindow[];
  /**
   * False when CLEANCLOUD_MAX_WINDOWS cut the plan short of the horizon.
   *
   * Reported rather than assumed away. The cap is comfortably above what ten
   * years needs today, so it does nothing — but a horizon someone widens later
   * would hit it, and a cap that silently shortens the history is exactly the
   * quiet partial import `truncated` exists to prevent.
   */
  coversFullHistory: boolean;
}

const MS_PER_DAY = 86_400_000;

/**
 * The windows covering `historyYears` back from `now`, newest first, each at
 * most `CLEANCLOUD_WINDOW_DAYS` long and none overlapping.
 *
 * Both ends are inclusive — CleanCloud's range is a closed interval — so each
 * window ends the day before the previous one begins rather than on the same
 * day. An overlap would not corrupt anything (the ingest dedupes on
 * `customerID`) but it would quietly pay for the same request twice.
 */
export function customerWindows(
  now: Date,
  historyYears: number = CLEANCLOUD_HISTORY_YEARS,
): WindowPlan {
  const earliest = startOfUtcDay(now);
  earliest.setUTCFullYear(earliest.getUTCFullYear() - historyYears);

  const windows: DateWindow[] = [];
  let to = startOfUtcDay(now);
  while (to >= earliest && windows.length < CLEANCLOUD_MAX_WINDOWS) {
    const span = (CLEANCLOUD_WINDOW_DAYS - 1) * MS_PER_DAY;
    const from = new Date(Math.max(to.getTime() - span, earliest.getTime()));
    windows.push({ from, to });
    to = new Date(from.getTime() - MS_PER_DAY);
  }
  return { windows, coversFullHistory: to < earliest };
}

/**
 * The `YYYY-MM-DD` form CleanCloud's date parameters take.
 *
 * UTC, and built from the date parts rather than sliced off an ISO string, so
 * a host running west of Greenwich cannot shift the window by a day.
 */
export function cleanCloudDate(value: Date): string {
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
