/**
 * A wall-clock budget for a paged upstream pull.
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
 * Lives in `common/` because the shape is not a CRM idea: any loop that pages
 * an upstream has the same arithmetic, and the second caller should not have to
 * import from `integrations/` to say so. See ADR 0231 and ADR 0238.
 *
 * **What expiry means is the caller's to decide, and the two callers differ.**
 * A contacts pull reports `truncated` and keeps what it has, because a partial
 * import is a stated outcome the customer can read. The catalog pull throws,
 * because `deactivateRetired` deactivates every card absent from the fetched
 * set — a partial catalog would quietly unpublish the rest of the shop.
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

/**
 * How long the Airtable catalog pull may take, in total.
 *
 * The same two minutes, reached by a different argument. A healthy catalog is a
 * handful of pages and finishes in seconds, so this is far outside normal — but
 * unlike the contacts pull, running out here is a *failure*, so the number has
 * to be generous enough that a slow-but-working Airtable is never mistaken for
 * a broken one.
 *
 * The ceiling it replaces was not theoretical: 100 pages x 4 attempts x a 15s
 * deadline, plus backoffs capped at 30s, is over four hours — on
 * `POST /catalog/sync`, which an operator waits on synchronously.
 *
 * One number for both callers rather than a longer budget for the nightly cron.
 * A cron that fails is visible in the ops summary and retries tomorrow; two
 * budgets would be two behaviours to hold in mind for no gain today.
 */
export const CATALOG_FETCH_BUDGET_MS = 120_000;

/**
 * How long the Stripe subscription-invoice backfill may spend paging.
 *
 * A third caller, a third meaning for expiry. This one *truncates*, like the
 * contacts pulls and unlike the catalog: the summary already carries
 * `truncated` for hitting the 200-page cap, every write is an upsert on
 * Stripe's invoice id, and the class comment records that the backfill is safe
 * to re-run at any time. So stopping early costs a re-run, not correctness.
 *
 * `POST /admin/subscription-invoices/backfill` is synchronous and awaited, so
 * the same argument applies as everywhere else: an operator should be told it
 * stopped early, not left holding a request.
 */
export const INVOICE_BACKFILL_BUDGET_MS = 120_000;

/**
 * How long one wallet-campaign sweep may spend crediting accounts.
 *
 * A fourth caller, and it truncates like the contacts pull rather than throwing
 * like the catalog: the accounts it did not reach are still in-window and the
 * sweep runs again in an hour, so stopping early costs a delay, not a credit.
 *
 * The sweep makes one Supabase lookup per candidate account to confirm the
 * address — see ADR 0188 for why that is a record lookup rather than a token
 * claim — so it is an outbound-call loop like the others, however small the
 * numbers are today.
 */
export const CAMPAIGN_SWEEP_BUDGET_MS = 120_000;

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
