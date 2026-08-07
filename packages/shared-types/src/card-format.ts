/**
 * The physical format of the cards we print. Today we stock a single size — A6 —
 * so this is the one source of truth for that fact and the customer-facing copy
 * that states it. When more sizes ship, this is where the size list (and the
 * "only A6 for now" messaging) is retired or turned into a real choice.
 */

/** The paper size we currently print, as a short code. */
export const CARD_SIZE_CODE = "A6";

/** The A6 trimmed dimensions, portrait, in millimetres. */
export const CARD_SIZE_DIMENSIONS = "105 × 148 mm";

/** "A6 (105 × 148 mm)" — the size named with its dimensions, for labels. */
export const CARD_SIZE_LABEL = `${CARD_SIZE_CODE} (${CARD_SIZE_DIMENSIONS})`;

/**
 * The one-line notice shown wherever a customer chooses or buys a card, so
 * everyone knows the size before they pay. Rendered identically across the card
 * library, the card preview and every checkout summary.
 */
export const CARD_SIZE_NOTICE = `All cards are printed ${CARD_SIZE_LABEL}. More sizes are coming soon.`;
