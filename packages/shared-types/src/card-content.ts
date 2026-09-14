/**
 * Content pre-flight: the questions worth asking about what a card *says*,
 * before it is printed and posted to a named human being.
 *
 * Two cards prompted this module. One carried two messages stacked on the same
 * face — the recipient's and somebody else's, overlapping. The other was
 * addressed by hand to a person who was not the one receiving it. Neither was a
 * rendering fault: both documents said exactly what they were asked to say, and
 * nothing in the product ever asked whether that made sense.
 *
 * The maths lives here, pure and shared, so the design editor, the pre-send
 * check and any ops panel cannot disagree about what "two messages on top of
 * each other" means. Nothing here does I/O and nothing here changes a document —
 * detection only. Deleting a customer's text block is never ours to decide; see
 * docs/card-content-preflight-plan.md (D1).
 */

import type { DesignDocument, DesignElement, DesignPage } from "./card";
import { CARD_WIDTH, textWrapWidth, type Rect } from "./design-layout";

/** A text element, narrowed out of the element union. Exported because callers
 *  measuring one box at a time (and the tests) need the same narrowing. */
export type TextElement = Extract<DesignElement, { kind: "text" }>;

/**
 * Line height as a multiple of font size, matching the 1.3 the renderers and
 * `backArtworkInReservedFooter` already assume.
 */
export const TEXT_LINE_HEIGHT = 1.3;

/**
 * Average glyph width as a fraction of font size, for estimating how many lines
 * a string wraps to.
 *
 * Deliberately on the **narrow** side of a real proportional face. A narrower
 * glyph fits more characters per line, which yields fewer lines, a shorter box
 * and therefore *less* detected overlap. That is the direction we want to err
 * in: this feeds a warning shown to a customer mid-design, and a warning that
 * fires on cards which are actually fine is one people learn to dismiss.
 */
const GLYPH_WIDTH_FACTOR = 0.45;

/**
 * How much of the smaller of two text boxes must be covered by the other before
 * we call it a stack.
 *
 * A fifth. Text deliberately placed over text — a caption across a banner — is
 * legitimate design and usually clips a corner; two messages written for
 * different people land almost on top of each other. Pinned by a test rather
 * than tuned by feel, and cheap to move if real designs say otherwise.
 */
export const OVERLAP_MIN_FRACTION = 0.2;

/** Merge tokens, e.g. `{firstName}` — the same pattern `applyMergeText` uses. */
const MERGE_TOKEN = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * The box a text element renders into, estimated from the document alone.
 *
 * **Approximate, and deliberately so.** A text element's real height depends on
 * word wrapping and on which font has loaded, which only a renderer knows —
 * `backArtworkInReservedFooter` documents the same trap and makes the same
 * choice. Explicit newlines are counted exactly; wrapping is estimated with a
 * narrow glyph so the box comes out shorter rather than taller.
 *
 * Returns `null` for a rotated element: an axis-aligned box is the wrong shape
 * for it, and a rotated text block is a deliberate act of design rather than the
 * accident this module is looking for.
 */
export function estimatedTextBox(
  element: TextElement,
  cardWidth: number = CARD_WIDTH,
): Rect | null {
  if (element.rotation) return null;

  const wrapWidth = textWrapWidth(element, cardWidth);
  const charsPerLine = Math.max(1, Math.floor(wrapWidth / (element.fontSize * GLYPH_WIDTH_FACTOR)));

  // Count each authored line separately, so a blank line between paragraphs
  // costs a line exactly as it does on the card, and track the longest so the
  // box can be narrowed to the text rather than the box it is allowed to fill.
  let lines = 0;
  let longestChars = 0;
  for (const authored of element.text.split("\n")) {
    lines += Math.max(1, Math.ceil(authored.length / charsPerLine));
    longestChars = Math.max(longestChars, Math.min(authored.length, charsPerLine));
  }

  // The *inked* width, not the wrap width. A short line in a wide text box
  // leaves most of that box empty, and treating the empty part as occupied is
  // how a caption beside a heading gets reported as sitting on top of it.
  const width = Math.min(wrapWidth, longestChars * element.fontSize * GLYPH_WIDTH_FACTOR);

  // Where that ink sits inside the box depends on the alignment the element
  // carries; left is the default and needs no offset.
  const slack = Math.max(0, wrapWidth - width);
  const align = element.align ?? "left";
  const x = element.x + (align === "center" ? slack / 2 : align === "right" ? slack : 0);

  return {
    x,
    y: element.y,
    width,
    height: lines * element.fontSize * TEXT_LINE_HEIGHT,
  };
}

/** Area of the intersection of two axis-aligned boxes. Zero when they miss. */
function intersectionArea(a: Rect, b: Rect): number {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (overlapX <= 0 || overlapY <= 0) return 0;
  return overlapX * overlapY;
}

/**
 * How much two boxes share, as a fraction of the **smaller** one.
 *
 * The rule, separated from where the boxes came from. The pre-send check
 * estimates them from the stored document because that is all a server has; the
 * editor measures the rendered Konva nodes, which is strictly better informed.
 * Sharing this rather than the measurement is what stops the two quietly
 * disagreeing about what "overlapping" means — the same reason the canvas reuses
 * `isInBackReservedFooter` instead of keeping its own copy of where the band is.
 *
 * Judged against the smaller box on purpose: a short line lost inside a long
 * message is exactly the case that matters, and measuring against the larger box
 * would score that at a few per cent and say nothing. Zero for a degenerate box.
 */
export function overlapFraction(a: Rect, b: Rect): number {
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  if (smaller <= 0) return 0;
  return intersectionArea(a, b) / smaller;
}

/** Two text elements found sitting on top of each other, and by how much. */
export interface StackedText {
  /** The two element ids, in the order they appear in the page. */
  ids: [string, string];
  /** The text each carries, for a message that can name what it found. */
  texts: [string, string];
  /** Fraction of the *smaller* box the two share, 0..1. */
  fraction: number;
}

/**
 * Pairs of text elements on one page whose estimated boxes overlap by more than
 * {@link OVERLAP_MIN_FRACTION} of the smaller one.
 *
 * Judged against the smaller box on purpose: a short line lost inside a long
 * message is exactly the case that matters, and measuring against the larger box
 * would score that as a few per cent and say nothing.
 */
/** Two boxes found sitting on each other, and by how much. */
export interface BoxOverlap<T> {
  a: T;
  b: T;
  /** Fraction of the *smaller* box the two share, 0..1. */
  fraction: number;
}

/**
 * Every pair of boxes overlapping by more than {@link OVERLAP_MIN_FRACTION} of
 * the smaller one. Each pair once, in the order given. Pure.
 *
 * Extracted because two callers need it from different measurements and must
 * not answer differently: the pre-send check estimates boxes from the stored
 * document because a server has nothing else, while the editor canvas measures
 * the rendered Konva nodes and can account for wrapping and the font that
 * actually loaded. What they share is the *rule* — anything else is two
 * definitions of "overlapping" waiting to disagree in front of a customer.
 */
export function overlappingBoxes<T extends { box: Rect }>(items: readonly T[]): BoxOverlap<T>[] {
  const found: BoxOverlap<T>[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]!;
      const b = items[j]!;
      const fraction = overlapFraction(a.box, b.box);
      if (fraction > OVERLAP_MIN_FRACTION) found.push({ a, b, fraction });
    }
  }
  return found;
}

export function stackedTextOnPage(page: DesignPage, cardWidth: number = CARD_WIDTH): StackedText[] {
  const boxed: { element: TextElement; box: Rect }[] = [];
  for (const element of page.elements) {
    if (element.kind !== "text") continue;
    const box = estimatedTextBox(element, cardWidth);
    // An empty string occupies no space and cannot be read; it is not a message
    // sitting on another one.
    if (box && element.text.trim() !== "") boxed.push({ element, box });
  }

  return overlappingBoxes(boxed).map(({ a, b, fraction }) => ({
    ids: [a.element.id, b.element.id],
    texts: [a.element.text, b.element.text],
    fraction,
  }));
}

/** A face of a document, with the stacked pairs found on it. */
export interface StackedTextFace {
  face: DesignPage["name"];
  stacked: StackedText[];
}

/**
 * Every face of a document carrying stacked text. Faces with none are omitted,
 * so an empty array means "nothing to say".
 *
 * Callers hand this a `SavedDesign.document` or an `OrderRecipient`'s own
 * snapshot, both of which are Prisma `Json` reached through a cast rather than a
 * parse — so the shape is asserted, not known. A document that does not match
 * must read as "nothing found" and never throw: this runs on a checkout path,
 * and a TypeError there is a 500 on a customer's payment over a document we
 * simply could not read.
 */
export function stackedTextInDocument(
  document: DesignDocument,
  cardWidth: number = CARD_WIDTH,
): StackedTextFace[] {
  const pages = document?.pages;
  if (!Array.isArray(pages)) return [];

  const faces: StackedTextFace[] = [];
  for (const page of pages) {
    if (!page || !Array.isArray(page.elements)) continue;
    const stacked = stackedTextOnPage(page, cardWidth);
    if (stacked.length > 0) faces.push({ face: page.name, stacked });
  }
  return faces;
}

/** A first name found written into a design by hand, and where. */
export interface LiteralName {
  face: DesignPage["name"];
  /** The name as the caller supplied it, not as it appears in the text. */
  name: string;
  /** The element's full text, so a warning can quote what it actually says. */
  text: string;
}

/** Escape a name for use inside a RegExp — names can contain "." or "-". */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Which of `names` appear as literal words in a document's text.
 *
 * Merge tokens are stripped first, so a design written properly as
 * `To {firstName}` never matches — only a name somebody typed out. Matching is
 * whole-word and case-insensitive, and uses lookarounds rather than `\b` so a
 * name is not found inside a longer word ("Al" in "Always").
 *
 * The caller decides what this means. The useful comparison is against the first
 * names of the recipients a batch is going to: a design that says "Florence"
 * going to Elise is worth a word before payment. It is a warning and not a
 * block, because "To Mum" and a card that mentions a name for an unrelated
 * reason are both perfectly legitimate — see docs/card-content-preflight-plan.md
 * (D2).
 */
export function literalNamesIn(document: DesignDocument, names: readonly string[]): LiteralName[] {
  const pages = document?.pages;
  if (!Array.isArray(pages)) return [];

  const wanted = names.map((name) => name.trim()).filter((name) => name.length > 0);
  if (wanted.length === 0) return [];

  // Built once per call rather than once per element: a send is checked against
  // every first name it is going to, so this is names x elements otherwise.
  const patterns = wanted.map((name) => ({
    name,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escapeForRegExp(name)}(?![\\p{L}\\p{N}])`, "iu"),
  }));

  const found: LiteralName[] = [];
  for (const page of pages) {
    if (!page || !Array.isArray(page.elements)) continue;
    for (const element of page.elements) {
      if (element.kind !== "text") continue;
      const withoutTokens = element.text.replace(MERGE_TOKEN, " ");
      for (const { name, pattern } of patterns) {
        if (pattern.test(withoutTokens)) {
          found.push({ face: page.name, name, text: element.text });
        }
      }
    }
  }
  return found;
}

/**
 * Words that follow a salutation and are not somebody's name.
 *
 * Relationship words are here deliberately, not by oversight: "To Mum" and "To
 * the team" are perfectly good cards and flagging them would be exactly the
 * false positive that teaches people to ignore the warning. See
 * docs/card-content-preflight-plan.md (D2).
 */
const NOT_A_NAME = new Set([
  "a",
  "all",
  "auntie",
  "aunty",
  "both",
  "class",
  "colleagues",
  "dad",
  "daddy",
  "everybody",
  "everyone",
  "father",
  "friend",
  "friends",
  "gran",
  "grandad",
  "grandma",
  "grandpa",
  "granny",
  "madam",
  "mother",
  "mum",
  "mummy",
  "my",
  "nan",
  "nana",
  "our",
  "sir",
  "somebody",
  "someone",
  "staff",
  "team",
  "the",
  "them",
  "there",
  "uncle",
  "us",
  "you",
]);

/**
 * A salutation line naming one person, e.g. `To Florence,` or `Dear alex,`.
 *
 * Matched only when the salutation is the **whole line**, which is how a card is
 * actually written and what keeps this precise: "Welcome to Kip" is not a
 * salutation, and neither is a sentence that happens to contain "to". Merge
 * tokens are stripped first, so `To {firstName}` — the correct way to write
 * this — leaves nothing to match.
 *
 * Case is not required. The card that prompted this said "Dear alex,", in lower
 * case, and a check that only noticed capitalised names would have missed it.
 */
const SALUTATION_LINE = /^\s*(?:to|dear|hi|hello|hey)\s+([\p{L}][\p{L}'\u2019-]*)\s*[,.!]?\s*$/iu;

/**
 * Every person a document addresses by hand.
 *
 * The precise half of "does this card name somebody?": a salutation is
 * unambiguously written to one person, so on a send going to anyone else it is
 * wrong for all of them. It needs no list of names to compare against, which is
 * what lets it catch a name belonging to nobody in the send at all — the card
 * for Cole Fortes that opened "Dear alex,".
 */
export function salutationNames(document: DesignDocument): LiteralName[] {
  const pages = document?.pages;
  if (!Array.isArray(pages)) return [];

  const found: LiteralName[] = [];
  for (const page of pages) {
    if (!page || !Array.isArray(page.elements)) continue;
    for (const element of page.elements) {
      if (element.kind !== "text") continue;
      for (const line of element.text.replace(MERGE_TOKEN, " ").split("\n")) {
        const match = SALUTATION_LINE.exec(line);
        const name = match?.[1];
        if (!name || NOT_A_NAME.has(name.toLowerCase())) continue;
        found.push({ face: page.name, name, text: element.text });
      }
    }
  }
  return found;
}

/** A person a design names by hand, and how wrong that is for this send. */
export interface NamedByHand {
  face: DesignPage["name"];
  name: string;
  /**
   * The cards in this send that are *not* for this person — the number that
   * makes the finding worth reading. "1 of 1" is a card addressed to the wrong
   * person; "7 of 7" is a batch carrying somebody else's name.
   */
  wrongFor: number;
  /**
   * Whether an interactive send has to be acknowledged before it will go
   * through, rather than merely warned about.
   *
   * True only for a **salutation** that is wrong for at least one card. A
   * salutation is the precise half of this check: `SALUTATION_LINE` matches a
   * line that is nothing but a greeting naming one person, so it cannot fire on
   * prose. A recipient's first name found loose in the text cannot make that
   * claim — a card to Joy that says "wishing you joy" is not a mistake — so it
   * stays a warning and never blocks. See docs/card-message-guardrails-plan.md
   * (D3).
   */
  mustAcknowledge: boolean;
}

/** Compare names the way a person would: ignoring case and surrounding space. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Everyone this document names by hand, checked against who the send is going
 * to.
 *
 * Found two ways, because they catch different mistakes. A salutation names one
 * person outright and needs nothing to compare against, so it finds "Dear alex,"
 * on a send containing no Alex at all. A recipient's own first name appearing
 * literally is wrong for every *other* card in the same send, which only a
 * comparison can see.
 *
 * One row per person per face, however many ways they were found — and the row
 * remembers whether a salutation is what found them, because only that half is
 * precise enough to stand in the way of a send.
 *
 * Shared by the pre-send check and the send itself so the two can never disagree
 * about who has been named.
 */
export function namedByHandInDocument(
  document: DesignDocument,
  firstNames: readonly string[],
): NamedByHand[] {
  const keyOf = (finding: LiteralName) => `${finding.face}:${finding.name.trim().toLowerCase()}`;
  const salutations = salutationNames(document);
  const fromSalutation = new Set(salutations.map(keyOf));

  const byKey = new Map<string, NamedByHand>();
  for (const finding of [...salutations, ...literalNamesIn(document, firstNames)]) {
    const key = keyOf(finding);
    if (byKey.has(key)) continue;
    const wrongFor = firstNames.filter((firstName) => !sameName(firstName, finding.name)).length;
    byKey.set(key, {
      face: finding.face,
      name: finding.name,
      wrongFor,
      mustAcknowledge: fromSalutation.has(key) && wrongFor > 0,
    });
  }
  return [...byKey.values()];
}

/**
 * The names a send still has to own up to: every `mustAcknowledge` finding the
 * request has not confirmed, deduplicated and in the spelling the card uses.
 *
 * Matched on the **name**, not on a flag, so the acknowledgement cannot become a
 * one-time dismissal: a send confirmed for "Florence" that is then edited to say
 * "Alex" has confirmed nothing about Alex and is asked again.
 */
export function unacknowledgedNames(
  findings: readonly NamedByHand[],
  acknowledged: readonly string[] = [],
): string[] {
  const outstanding: string[] = [];
  for (const finding of findings) {
    if (!finding.mustAcknowledge) continue;
    if (acknowledged.some((name) => sameName(name, finding.name))) continue;
    if (outstanding.some((name) => sameName(name, finding.name))) continue;
    outstanding.push(finding.name);
  }
  return outstanding;
}
