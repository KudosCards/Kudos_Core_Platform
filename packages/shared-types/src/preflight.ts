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

/**
 * How many of this send's cards would post timed to their own recipient's dated
 * occasion rather than one shared date, and the span those dates cover.
 *
 * Occasion dating is the default for a send with no delivery date (ADR 0167), so
 * without this the composer could not tell a sender whether "send now" means
 * today or means spread across ten months — which is exactly the surprise the
 * default was introduced to prevent. Computed with the same lookup the send
 * itself uses, so the preview and the outcome cannot disagree.
 *
 * Counted over the *mailable* recipients only, matching `price`: a contact with
 * no valid address gets no card, so counting them would overstate the spread.
 */
export interface PreflightOccasionDating {
  count: number;
  /** ISO `YYYY-MM-DD` of the soonest and furthest matched occasion, or null when
   * nothing matched. */
  earliest: string | null;
  latest: string | null;
  /**
   * Contacts in this send whose birthday is still ahead of them but has been
   * skipped, so the send cannot time a card to it.
   *
   * Counted separately because the composer used to fold them in with the
   * contacts who have no birthday at all and tell the sender "no occasion on
   * file" — which is untrue, and hides the one thing they could act on. A school
   * that cleared its approvals queue in a hurry, skipping ten live birthdays,
   * read that line fifteen minutes later and had no way to know what it meant.
   */
  skipped: number;
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
  /** The exact, VAT-decomposed price for the **mailable** cards only — the set
   * that will actually be charged (a card with no valid address gets no order
   * line), so this matches the eventual Stripe total, not the composer's rough
   * estimate. Its `cardCount` can be lower than `total` when contacts still need
   * an address. */
  price: PricingBreakdown;
  /** What "no delivery date" would actually do to this selection's timing. */
  occasionDated: PreflightOccasionDating;
  /**
   * Content on the design's back face that falls in the strip already printed
   * with the Kudos logo and QR, and so will not be printed (ADR 0166).
   *
   * A property of the *design*, not of any recipient, so it sits here rather
   * than in a bucket: a bucket would list every recipient in the run for one
   * problem that is the same on all of them.
   */
  backArtworkClipped: { background: boolean; elements: number };
}

/** The sender's timing choice, as the composer's picker reports it. `null` means
 * they haven't chosen yet. */
export type SendTimingMode = "now" | "occasion" | "scheduled";

/**
 * The `useOccasionDates` instruction a bulk send should carry, or undefined to
 * leave it to the server's default.
 *
 * Occasion dating is the default for a send with no delivery date (ADR 0167), so
 * this decides when to *override* it, reconciling three signals that can each
 * speak to timing:
 *
 * - A pure event send is dated by its reconcile list and never shows the timing
 *   picker, so leave the default alone.
 * - The sender turned off "mark these as handled" — a deliberate "send this as
 *   well as their occasion card" (ADR 0107) — so don't let the server find that
 *   occasion by another route and consume it anyway.
 * - Otherwise the timing choice decides, but only once preflight has told us
 *   what the alternative was. Taking "one date for everyone" literally before we
 *   have shown the sender that some cards *would* have been spread would quietly
 *   undo the very default the picker exists to expose.
 *
 * Lives here rather than in the composer so the precedence can be tested: it is
 * the one piece of this flow where getting the order wrong sends real post on
 * the wrong day, and the web app has no test runner.
 */
export function occasionDatesInstruction(input: {
  isEventSend: boolean;
  hasReconcileMatches: boolean;
  markHandled: boolean;
  preflightReady: boolean;
  timingMode: SendTimingMode | null;
}): boolean | undefined {
  if (input.isEventSend) return undefined;
  if (input.hasReconcileMatches && !input.markHandled) return false;
  if (!input.preflightReady || input.timingMode === null) return undefined;
  if (input.timingMode === "occasion") return true;
  if (input.timingMode === "now") return false;
  return undefined;
}
