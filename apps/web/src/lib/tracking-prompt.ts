/** What the operator answered, ready to merge into the transition body. */
export type TrackingPromptResult = { trackingReference?: string };

/**
 * Ask for the optional tracking reference before a card is marked posted.
 *
 * Returns `null` when the operator backed out — Cancel or Escape — and an
 * object (possibly empty) when they answered. The two are different answers and
 * the distinction lives here, once, because getting it wrong is expensive and
 * it was got wrong in both places that asked.
 *
 * `window.prompt` returns `null` on Cancel and `""` on a blank submit. Both
 * call sites wrote `window.prompt(...) ?? ""`, which folds backing out into
 * "left blank" — so an operator who clicked the wrong row and pressed Escape
 * still posted the card. `postedAt` is stamped and the row leaves the queue,
 * and there is no reverse transition in the product: the only action left on a
 * posted card is "Returned to sender", which opens a recovery case and flags
 * the contact's address. See ADR 0197.
 */
export function promptTrackingReference(): TrackingPromptResult | null {
  const answer = window.prompt("Tracking reference (optional):");
  if (answer === null) return null;
  const trimmed = answer.trim();
  return trimmed ? { trackingReference: trimmed } : {};
}
