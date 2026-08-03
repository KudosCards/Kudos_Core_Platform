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

/** Smallest side (design units) any resizable element may be scaled down to, so
 * a handle-drag can't shrink something to nothing. */
export const MIN_ELEMENT_SIZE = 12;
/** Smallest font size (design units) a text element may be scaled down to. */
export const MIN_FONT_SIZE = 6;

/**
 * Fold a Konva Transformer scale factor into a real dimension and reset the node
 * scale to 1, so element geometry always stays in plain design units (never a
 * lingering scaleX/scaleY). Rounded, and floored at `min`. Pure.
 */
export function bakeScale(value: number, scale: number, min: number = MIN_ELEMENT_SIZE): number {
  return Math.max(min, Math.round(value * scale));
}

/** Normalise a rotation to [0, 360) degrees. Pure. */
export function normaliseRotation(degrees: number): number {
  const r = degrees % 360;
  const normalised = r < 0 ? r + 360 : r;
  // Collapse a signed -0 (e.g. -360 % 360) to a plain 0.
  return normalised === 0 ? 0 : normalised;
}

/** Distance (design units) within which a dragged edge/centre snaps to a guide. */
export const SNAP_THRESHOLD = 6;

/** A single alignment guide line the editor draws while dragging. `axis: "x"` is
 * a vertical line at that x; `axis: "y"` is a horizontal line at that y. */
export interface SnapLine {
  axis: "x" | "y";
  position: number;
}

export interface SnapResult {
  /** The box's snapped top-left origin (unchanged on an axis that didn't snap). */
  x: number;
  y: number;
  /** The guide lines to draw — at most one per axis. */
  guides: SnapLine[];
}

/**
 * The card's built-in snap lines on each axis: the two edges, the two safe-area
 * margins, and the centre — so an element clicks to the middle of the card or
 * flush with the safe frame. Pure.
 */
export function cardSnapLines(
  card: { width: number; height: number } = { width: CARD_WIDTH, height: CARD_HEIGHT },
  margin: number = CARD_SAFE_MARGIN,
): { x: number[]; y: number[] } {
  return {
    x: [0, margin, card.width / 2, card.width - margin, card.width],
    y: [0, margin, card.height / 2, card.height - margin, card.height],
  };
}

/**
 * Snap a dragged box to the nearest alignment line on each axis (Moonpig/Figma
 * style). The box's left / centre / right (x) and top / middle / bottom (y) are
 * each tested against the candidate lines; the closest match within `threshold`
 * wins per axis. Returns the adjusted top-left origin plus the guide lines to
 * draw (at most one per axis). Pure — the canvas measures real boxes and feeds
 * them in; this is just the maths, so it can be unit-tested without a browser.
 */
export function computeSnap(
  box: { x: number; y: number; width: number; height: number },
  targets: { x: number[]; y: number[] },
  threshold: number = SNAP_THRESHOLD,
): SnapResult {
  const pick = (anchors: number[], lines: number[]) => {
    let bestDist = threshold + 1;
    let delta = 0;
    let line: number | null = null;
    for (const anchor of anchors) {
      for (const candidate of lines) {
        const dist = Math.abs(anchor - candidate);
        if (dist <= threshold && dist < bestDist) {
          bestDist = dist;
          delta = candidate - anchor;
          line = candidate;
        }
      }
    }
    return { delta, line };
  };

  const sx = pick([box.x, box.x + box.width / 2, box.x + box.width], targets.x);
  const sy = pick([box.y, box.y + box.height / 2, box.y + box.height], targets.y);

  const guides: SnapLine[] = [];
  if (sx.line !== null) guides.push({ axis: "x", position: sx.line });
  if (sy.line !== null) guides.push({ axis: "y", position: sy.line });

  return { x: box.x + sx.delta, y: box.y + sy.delta, guides };
}

/** How to restack an element within its page: one step, or all the way. */
export type LayerMove = "front" | "back" | "forward" | "backward";

/**
 * Reorder one element within a design page's element array to change its
 * stacking. The array order *is* the z-order — the canvas and every preview
 * draw elements in array order, so a later element sits on top. Returns a new
 * array (the original is untouched); a no-op order when the element is missing
 * or already at the relevant end. Generic over `{ id }` so it stays decoupled
 * from the element union and easy to unit-test. Pure.
 */
export function reorderElement<T extends { id: string }>(
  elements: T[],
  id: string,
  move: LayerMove,
): T[] {
  const index = elements.findIndex((el) => el.id === id);
  if (index === -1) return elements;
  const next = [...elements];
  const [item] = next.splice(index, 1);
  switch (move) {
    case "front":
      next.push(item!);
      break;
    case "back":
      next.unshift(item!);
      break;
    case "forward":
      next.splice(Math.min(index + 1, next.length), 0, item!);
      break;
    case "backward":
      next.splice(Math.max(index - 1, 0), 0, item!);
      break;
  }
  return next;
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
