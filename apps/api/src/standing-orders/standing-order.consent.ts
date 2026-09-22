/**
 * What a subscriber agrees to when they switch "click and forget" on, and how
 * we know whether they still have.
 *
 * A standing order spends money from their wallet, and prints and posts things
 * in their name, without asking again. That is a permission, not a preference,
 * so it is recorded the way a permission should be: who gave it, when, and
 * **which words they were shown**.
 *
 * The version is the point. An `enabled` flag alone says they once agreed to
 * something; it cannot say whether they agreed to what the product does today.
 * So when this statement changes materially, the version goes up, every
 * existing consent stops covering it, and the instruction is no longer active
 * until somebody reads the new wording and agrees. That is deliberately
 * inconvenient — it is the only version of this that stays honest.
 *
 * See docs/adr/0256.
 */

/** Bump ONLY when the statement below changes what we are permitted to do.
 * Fixing a typo is not a bump; adding a thing we will do is. */
export const STANDING_ORDER_CONSENT_VERSION = 1;

/**
 * The words. Kept here rather than in the web app so the record of what was
 * agreed lives beside the code that enforces it, and so a reviewer changing the
 * promise has to walk past the version constant to do it.
 */
export const STANDING_ORDER_CONSENT_STATEMENT = [
  "You are asking Kudos to send cards for you without checking with you first.",
  "We will send a card for each birthday in the contacts you choose, using one of the designs and one of the messages you have approved here.",
  "Each card is paid for from your wallet balance at the time it is sent, at your plan's usual card and postage price.",
  "If your balance will not cover a card, we tell you rather than send it.",
  "You can switch this off at any time, and changing anything here does not affect cards already on their way.",
] as const;

/**
 * Whether a recorded consent still covers what the product does.
 *
 * Null version means never consented. An older version means they agreed to
 * something we have since changed.
 */
export function consentIsCurrent(consentVersion: number | null): boolean {
  return consentVersion === STANDING_ORDER_CONSENT_VERSION;
}
