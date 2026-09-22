import type { DesignDocument } from "./card";

/**
 * Where a chosen message goes on a card.
 *
 * This was the open question left by ADR 0256, and it is the one decision in
 * "click and forget" that decides what is literally printed on paper somebody
 * opens. It is settled here rather than guessed at per call site.
 *
 * **The rule, and why each step is the way round it is.**
 *
 * 1. **The seeded block, by id.** `buildCardDocument` gives the inside-right
 *    message the id `inside-message`, and the editor's element update maps by
 *    id (`design-editor-client.tsx`), so the id survives every edit to the
 *    text. It dies only if somebody deletes that block and adds a new one —
 *    which is exactly when we should stop trusting it.
 * 2. **Otherwise the only text block on the inside-right page.** A catalog
 *    design has exactly one or none, so this covers a design whose message
 *    block was replaced rather than edited.
 * 3. **Otherwise nothing.** Two candidate blocks is a design somebody has
 *    built deliberately, and picking one of them is a coin toss printed on a
 *    card that cannot be recalled.
 *
 * What it must never do is add a block **beside existing text**. Two messages
 * stacked on one face is a defect this codebase already has machinery for
 * (`card-content.ts`), written after it shipped twice — once with the
 * recipient's message and somebody else's overlapping. A feature that created
 * that on purpose would be worse than one that printed nothing new.
 *
 * An inside page with **no** text is the one case where writing a block is
 * safe, because there is nothing to stack against — and it is not a rare one:
 * a member's own uploaded artwork starts from a blank document (ADR 0026), and
 * a catalog card whose Airtable "Inside Message" is empty gets no block either.
 * Without this those designs could never carry a message at all.
 *
 * See docs/adr/0260.
 */

/** The element a message would replace. */
export interface CardMessageSlot {
  pageIndex: number;
  elementId: string;
  /** What the design says today, so a caller can show what is being replaced. */
  currentText: string;
}

export type CardMessageSlotResult =
  { found: true; slot: CardMessageSlot } | { found: false; reason: CardMessageSlotRefusal };

export type CardMessageSlotRefusal =
  /** No inside-right page at all — not a four-page card. */
  | "no_inside_page"
  /** The inside-right page carries no text to replace. */
  | "no_text_block"
  /** Several text blocks and none is the seeded one: too close to call. */
  | "ambiguous";

/** The page a card's message lives on, by the name `buildCardDocument` uses. */
const MESSAGE_PAGE = "inside-right";

/** The id `buildCardDocument` seeds the message block with. */
export const SEEDED_MESSAGE_ELEMENT_ID = "inside-message";

export function findCardMessageSlot(document: DesignDocument): CardMessageSlotResult {
  const pageIndex = document.pages.findIndex((page) => page.name === MESSAGE_PAGE);
  if (pageIndex < 0) {
    return { found: false, reason: "no_inside_page" };
  }

  const texts = (document.pages[pageIndex]?.elements ?? []).filter(
    (element): element is Extract<typeof element, { kind: "text" }> => element.kind === "text",
  );
  if (texts.length === 0) {
    return { found: false, reason: "no_text_block" };
  }

  const seeded = texts.find((element) => element.id === SEEDED_MESSAGE_ELEMENT_ID);
  const chosen = seeded ?? (texts.length === 1 ? texts[0] : undefined);
  if (!chosen) {
    return { found: false, reason: "ambiguous" };
  }
  return {
    found: true,
    slot: { pageIndex, elementId: chosen.id, currentText: chosen.text },
  };
}

/**
 * The geometry a written-in message uses: the same block `buildCardDocument`
 * seeds, so a card that never had one ends up looking like a card that did.
 * Not re-derived here — imported would be circular, and these five numbers are
 * pinned by a test against the builder so they cannot drift apart.
 */
const MESSAGE_BLOCK = {
  x: 40,
  y: 40,
  fontFamily: "Helvetica",
  fontSize: 16,
  color: "#1a1a1a",
} as const;

/**
 * A copy of the document with the chosen message on it.
 *
 * Replaces the slot's text where there is one, writes a block where the inside
 * page is empty, and returns the document untouched when there is text but no
 * way to tell which block is the message.
 *
 * Untouched rather than refused on purpose: a card that goes carrying the
 * design's own words is a smaller failure than a birthday with no card at all,
 * and the subscriber is told which of their designs cannot take a message at
 * the point they choose them. Pure — the saved design is never modified, only
 * the per-card snapshot the order keeps.
 */
export function applyCardMessage(document: DesignDocument, text: string): DesignDocument {
  const result = findCardMessageSlot(document);
  if (!result.found) {
    return result.reason === "no_text_block"
      ? writeMessageBlock(document, text)
      : // "ambiguous" or no inside page: there is text here and no way to say
        // which of it is the message, so nothing is touched.
        document;
  }
  const { pageIndex, elementId } = result.slot;
  return {
    ...document,
    pages: document.pages.map((page, index) =>
      index !== pageIndex
        ? page
        : {
            ...page,
            elements: page.elements.map((element) =>
              element.kind === "text" && element.id === elementId ? { ...element, text } : element,
            ),
          },
    ),
  };
}

/** Write the message onto an inside page that has no text at all. Safe
 * precisely because there is nothing to stack against. */
function writeMessageBlock(document: DesignDocument, text: string): DesignDocument {
  const pageIndex = document.pages.findIndex((page) => page.name === MESSAGE_PAGE);
  if (pageIndex < 0) {
    return document;
  }
  return {
    ...document,
    pages: document.pages.map((page, index) =>
      index !== pageIndex
        ? page
        : {
            ...page,
            elements: [
              ...page.elements,
              { kind: "text" as const, id: SEEDED_MESSAGE_ELEMENT_ID, text, ...MESSAGE_BLOCK },
            ],
          },
    ),
  };
}
