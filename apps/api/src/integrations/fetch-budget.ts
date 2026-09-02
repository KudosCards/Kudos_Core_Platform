/**
 * A wall-clock budget for a contacts pull.
 *
 * Every provider client caps its paging loop, and `httpRequest` gives each
 * attempt a deadline and each retry a bounded delay — but nothing bounded their
 * *sum*. HubSpot's fifty pages, each retried up to four times with backoff, is
 * an arithmetic ceiling near fifty minutes, and "Sync now" is a request a
 * customer is sitting in front of. Before the retries existed the first 429
 * ended the pull in seconds; making each attempt robust made the whole
 * unbounded.
 *
 * Running out of budget is reported the same way as running out of pages:
 * `truncated`, which the sync turns into a status the customer can read and an
 * amber summary rather than a silent short pull (ADR 0227). "We stopped early"
 * was already a first-class outcome; this is another way to reach it.
 *
 * See ADR 0231.
 */

/**
 * How long a single provider's contacts pull may take, in total.
 *
 * Two minutes: long enough that a healthy portal of any size finishes inside
 * it, short enough that a manual sync fails visibly rather than appearing to
 * hang. The nightly sweep pays it per connection, sequentially, which is well
 * within a night.
 */
export const CONTACTS_FETCH_BUDGET_MS = 120_000;

export interface FetchBudget {
  /** True once the pull has run longer than it is allowed to. Checked between
   *  pages, never mid-request: a page already paid for is worth keeping. */
  expired(): boolean;
}

/** Start a budget. `now` is injectable so a test can exhaust it without waiting. */
export function startFetchBudget(
  budgetMs: number = CONTACTS_FETCH_BUDGET_MS,
  now: () => number = Date.now,
): FetchBudget {
  const startedAt = now();
  return { expired: () => now() - startedAt >= budgetMs };
}
