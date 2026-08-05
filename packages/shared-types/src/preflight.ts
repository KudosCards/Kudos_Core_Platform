import type { PricingBreakdown } from "./pricing";

/**
 * The bulk-send **preflight check** (ADR 0118): a server-authoritative summary of
 * a proposed run — before any money changes hands — so a sender knows exactly
 * how many cards are ready and which need attention, and sees the exact price.
 *
 * Buckets are independent warnings (a recipient can be in more than one). Each
 * carries a total `count` plus a bounded `sample` (the first N, for drill-in and
 * inline fixing) so the payload stays small even on a 10,000-card run.
 */
export interface PreflightIssue {
  recipientId: string;
  name: string;
  /** Human detail for this recipient, e.g. "Postcode looks invalid" or the
   * unresolved tokens ("{teacher}"). */
  detail: string;
}

export interface PreflightBucket {
  /** How many recipients fall in this bucket across the whole selection. */
  count: number;
  /** The first `count`-capped recipients, for drill-in / inline fixing. */
  sample: PreflightIssue[];
}

export interface BatchOrderPreflight {
  /** Recipients in the selection (that belong to the account). */
  total: number;
  /** Recipients with no issue in any bucket — good to send as-is. */
  ready: number;
  /** No postal address at all (a hard blocker — can't be posted). */
  missingAddress: PreflightBucket;
  /** Has an address, but the postcode fails UK validation or it's non-UK. */
  invalidPostcode: PreflightBucket;
  /** The design has merge tokens that won't resolve for this recipient, so they'd
   * print literally (e.g. a missing custom field). A warning, not a blocker. */
  unresolvedTokens: PreflightBucket;
  /** Recently ordered this same design — a possible accidental re-send. Warning. */
  duplicate: PreflightBucket;
  /** The exact, VAT-decomposed price for the whole selection — the amount that
   * will actually be charged (unlike the composer's rough estimate). */
  price: PricingBreakdown;
}
