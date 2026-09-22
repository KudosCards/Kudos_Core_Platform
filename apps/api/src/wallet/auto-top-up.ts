/**
 * Automatic wallet top-up: its bounds, why it stops, and what the customer is
 * told when it does. See docs/adr/0255.
 *
 * The same discipline as auto-send's skip reasons (ADR 0254): a failure carries
 * a code, the code picks the copy, and the wording can be rewritten without
 * touching behaviour. A Stripe decline message is written for a developer
 * reading a dashboard, not for somebody being told their cards have stopped.
 */

/**
 * The bounds a customer may set, re-exported from `@kudos/shared-types` so the
 * form and the validator cannot drift (ADR 0164) — the same arrangement
 * `billing.constants.ts` has with the card price.
 *
 * Thresholds run £1 to £200: below £1 the instruction could never fire before a
 * card had already failed, and above £200 it would top up an account that is
 * comfortably funded. Amounts run £5 to £1,000, the upper bound matching
 * `TopUpDto` — an unattended charge must never exceed what the same customer
 * could authorise by hand.
 */
export {
  AUTO_TOP_UP_AMOUNT_MAX_MINOR,
  AUTO_TOP_UP_AMOUNT_MIN_MINOR,
  AUTO_TOP_UP_THRESHOLD_MAX_MINOR,
  AUTO_TOP_UP_THRESHOLD_MIN_MINOR,
} from "@kudos/shared-types";

/** The defaults a customer switching it on starts from — £10 and £50 — so the
 * form is filled in rather than empty. Mirrors the column defaults. */
export const AUTO_TOP_UP_DEFAULT_THRESHOLD_MINOR = 1_000;
export const AUTO_TOP_UP_DEFAULT_AMOUNT_MINOR = 5_000;

/**
 * How far ahead the wallet watch looks when working out whether the balance
 * covers what has already been approved.
 *
 * 30 days, not the reminder email's 7 (ADR 0183). Seven days is the right
 * window for "act on this card now"; it is the wrong one for money, because
 * topping up is a decision somebody has to make and birthdays arrive in
 * clusters. A month is also how a customer thinks about funding an account.
 */
export const WALLET_HORIZON_DAYS = 30;

export const AUTO_TOP_UP_PAUSE_REASONS = [
  "no_payment_method",
  "card_declined",
  "authentication_required",
  "unknown",
] as const;

export type AutoTopUpPauseReason = (typeof AUTO_TOP_UP_PAUSE_REASONS)[number];

export interface AutoTopUpPauseCopy {
  /** Why it stopped, in the customer's language. One sentence. */
  why: string;
  /** The one thing they have to do. One sentence. */
  fix: string;
}

export function autoTopUpPauseCopy(reason: AutoTopUpPauseReason): AutoTopUpPauseCopy {
  switch (reason) {
    case "no_payment_method":
      return {
        why: "We do not have a card on file we can charge.",
        fix: "Add a card in billing, then switch automatic top-up back on.",
      };
    case "card_declined":
      return {
        why: "Your card was declined.",
        fix: "Check the card in billing — or top up by hand — then switch automatic top-up back on.",
      };
    case "authentication_required":
      // 3DS on an unattended charge: the bank wants the cardholder, and the
      // cardholder is not here. Nothing we can do from the cron.
      return {
        why: "Your bank asked us to confirm the payment with you, and we could not do that on your behalf.",
        fix: "Top up once by hand to satisfy your bank, then switch automatic top-up back on.",
      };
    case "unknown":
      return {
        why: "Something went wrong taking the payment.",
        fix: "We are looking into it. Top up by hand in the meantime so your cards keep going.",
      };
  }
}

/**
 * Classify a Stripe failure.
 *
 * Only the two outcomes the customer can act on are named. Everything else is
 * `unknown`, which is told to them *and* raised with Kudos HQ — the same rule
 * as ADR 0254, and for the same reason: a charge that failed for a reason we
 * cannot explain is when silence costs most.
 */
export function pauseReasonOfStripeError(error: unknown): AutoTopUpPauseReason {
  if (!isStripeCardError(error)) {
    // Not the card's fault, so "check your card" would waste the customer's
    // time and hide ours. Escalated instead.
    return "unknown";
  }
  // The card error is enough to know what to tell them; the code only picks
  // between the two things they would do about it. A card error that arrives
  // with no code at all is still a card problem, not a mystery.
  return declineCode(error) === "authentication_required"
    ? "authentication_required"
    : "card_declined";
}

/** Read structurally rather than with `instanceof Stripe.errors.StripeCardError`,
 * so a mocked Stripe in tests classifies exactly as the real one does. */
function isStripeCardError(error: unknown): error is { type: string; code?: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "StripeCardError"
  );
}

function declineCode(error: { code?: unknown }): string | null {
  return typeof error.code === "string" ? error.code : null;
}
