/**
 * Card geometry and layout guard rails, shared by the canvas editor and any
 * future server-side render so "where does content sit on the card" has one
 * definition. The card is authored in a fixed 450×600 design space (see
 * design-canvas.tsx); these are those units.
 */

/** The card's authoring width in design units. */
export const CARD_WIDTH = 450;
/** The card's authoring height in design units. */
export const CARD_HEIGHT = 600;

/**
 * Printer safe area — content should stay this far in from every edge so it
 * isn't lost to print bleed/trim. Shown as a dashed guide in the editor and
 * used to flag elements that stray outside it.
 */
export const CARD_SAFE_MARGIN = 24;

/** How much of an element must remain on the card when dragging, so it can't be
 * flung completely off and "lost". */
const MIN_VISIBLE = 24;

/** Padding kept between an unbounded text box and the card's right edge, so a
 * wrapped line doesn't touch the trim. Used only for the legacy (no explicit
 * width) fallback. */
export const TEXT_EDGE_PADDING = 16;

/**
 * The wrap width for a text element: its explicit `width` (the adjustable text
 * box) when set, else the distance to the card's right edge less padding — the
 * legacy behaviour. Shared by the editor canvas and every read-only preview so
 * text lays out identically everywhere. Pure.
 */
export function textWrapWidth(
  element: { x: number; width?: number },
  cardWidth: number = CARD_WIDTH,
): number {
  return element.width ?? Math.max(40, cardWidth - element.x - TEXT_EDGE_PADDING);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Clamp an element's top-left origin so it stays on the card while dragging —
 * the core "guard rail". A known `width`/`height` keeps the whole element on
 * the card; when a dimension is unknown (e.g. auto-height text) at least
 * MIN_VISIBLE of the element is kept on-card at that edge. Pure.
 */
export function clampElementPosition(
  pos: Point,
  size: { width?: number; height?: number },
  card: { width: number; height: number } = { width: CARD_WIDTH, height: CARD_HEIGHT },
): Point {
  const maxX =
    size.width !== undefined ? card.width - size.width : card.width - MIN_VISIBLE;
  const maxY =
    size.height !== undefined ? card.height - size.height : card.height - MIN_VISIBLE;
  return {
    x: clamp(pos.x, 0, maxX),
    y: clamp(pos.y, 0, maxY),
  };
}

/**
 * Whether an element's box strays outside the printer safe area — the signal
 * the editor uses to warn "this may be clipped when printed". `width`/`height`
 * are the element's rendered box (for text, the wrap width and measured
 * height). Pure.
 */
export function isOutsideSafeArea(
  box: { x: number; y: number; width: number; height: number },
  card: { width: number; height: number } = { width: CARD_WIDTH, height: CARD_HEIGHT },
  margin: number = CARD_SAFE_MARGIN,
): boolean {
  return (
    box.x < margin ||
    box.y < margin ||
    box.x + box.width > card.width - margin ||
    box.y + box.height > card.height - margin
  );
}
