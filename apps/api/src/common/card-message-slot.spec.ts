import {
  SEEDED_MESSAGE_ELEMENT_ID,
  applyCardMessage,
  buildCardDocument,
  findCardMessageSlot,
  type DesignDocument,
} from "@kudos/shared-types";

/**
 * Where a pooled message goes on a card.
 *
 * The one decision in "click and forget" that decides what is literally printed
 * on paper somebody opens, so the cases worth pinning are the ones where it
 * must refuse rather than the ones where it works.
 */

function text(id: string, value: string) {
  return {
    kind: "text" as const,
    id,
    text: value,
    x: 40,
    y: 40,
    fontFamily: "Helvetica",
    fontSize: 16,
    color: "#1a1a1a",
  };
}

function withInsideRight(elements: DesignDocument["pages"][number]["elements"]): DesignDocument {
  return {
    version: 1,
    pages: [
      { name: "front", elements: [] },
      { name: "inside-left", elements: [] },
      { name: "inside-right", elements },
      { name: "back", elements: [] },
    ],
  };
}

describe("finding a card's message slot", () => {
  it("uses the block the catalog seeded", () => {
    const document = buildCardDocument("https://art.test/a.png", "Happy Birthday!");
    const result = findCardMessageSlot(document);
    expect(result).toMatchObject({
      found: true,
      slot: { elementId: SEEDED_MESSAGE_ELEMENT_ID, currentText: "Happy Birthday!" },
    });
  });

  it("finds the seeded block even when it is not the only one", () => {
    // Somebody added a second line — a signature, a date. The seeded id is
    // still the message, and the editor preserves it through every text edit.
    const document = withInsideRight([
      text("decoration", "With love"),
      text(SEEDED_MESSAGE_ELEMENT_ID, "Happy Birthday!"),
    ]);
    const result = findCardMessageSlot(document);
    expect(result).toMatchObject({ found: true, slot: { elementId: SEEDED_MESSAGE_ELEMENT_ID } });
  });

  it("uses the only text block when the seeded one was replaced", () => {
    // They deleted the seeded block and typed a fresh one, which gets a new id.
    const document = withInsideRight([text("a-new-uuid", "Many happy returns")]);
    expect(findCardMessageSlot(document)).toMatchObject({
      found: true,
      slot: { elementId: "a-new-uuid" },
    });
  });

  it("refuses to choose between two blocks it did not seed", () => {
    // A design somebody built deliberately. Picking one is a coin toss printed
    // on a card that cannot be recalled.
    const document = withInsideRight([
      text("one", "Happy birthday"),
      text("two", "From all of us"),
    ]);
    expect(findCardMessageSlot(document)).toEqual({ found: false, reason: "ambiguous" });
  });

  it("refuses a card with nothing to replace", () => {
    expect(findCardMessageSlot(withInsideRight([]))).toEqual({
      found: false,
      reason: "no_text_block",
    });
  });

  it("refuses a document with no inside-right page", () => {
    const document: DesignDocument = { version: 1, pages: [{ name: "front", elements: [] }] };
    expect(findCardMessageSlot(document)).toEqual({ found: false, reason: "no_inside_page" });
  });

  it("ignores non-text elements when deciding", () => {
    // An image beside the message must not make the message ambiguous.
    const document = withInsideRight([
      {
        kind: "image",
        id: "photo",
        assetUrl: "https://art.test/p.png",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
      },
      text("only-text", "Happy birthday"),
    ]);
    expect(findCardMessageSlot(document)).toMatchObject({
      found: true,
      slot: { elementId: "only-text" },
    });
  });
});

describe("putting a message on a card", () => {
  it("replaces the slot's words and leaves everything else alone", () => {
    const document = buildCardDocument("https://art.test/a.png", "Happy Birthday!");
    const next = applyCardMessage(document, "Happy birthday {firstName} — have a good one.");

    const inside = next.pages.find((page) => page.name === "inside-right")!;
    expect(inside.elements).toHaveLength(1);
    expect(inside.elements[0]).toMatchObject({
      id: SEEDED_MESSAGE_ELEMENT_ID,
      text: "Happy birthday {firstName} — have a good one.",
      // Position, font and colour are the customer's design decisions.
      x: 40,
      fontSize: 16,
    });
    expect(next.pages.find((page) => page.name === "front")!.background).toEqual(
      document.pages.find((page) => page.name === "front")!.background,
    );
  });

  it("never adds a block beside existing text", () => {
    // Two messages stacked on one face is a defect this codebase already has
    // machinery for, written after it shipped twice. A feature that created it
    // on purpose would be worse than one that printed nothing new.
    const before = withInsideRight([text("one", "A"), text("two", "B")]);
    const after = applyCardMessage(before, "Happy birthday {firstName}");
    const inside = after.pages.find((page) => page.name === "inside-right")!;
    expect(inside.elements).toHaveLength(2);
  });

  it("leaves a card it cannot read exactly as it was", () => {
    // Two blocks and no way to say which is the message. It goes carrying the
    // design's own words: a birthday with no card at all is the larger failure,
    // and the subscriber is told which designs cannot take a message when they
    // choose them.
    const before = withInsideRight([text("one", "A"), text("two", "B")]);
    expect(applyCardMessage(before, "Happy birthday")).toEqual(before);
  });

  it("writes the message onto a card whose inside is blank", () => {
    // Not a rare case: a member's own uploaded artwork starts from a blank
    // document (ADR 0026), and a catalog card with no Airtable inside message
    // gets no block either. Without this, those designs could never carry one.
    const next = applyCardMessage(withInsideRight([]), "Happy birthday {firstName}");
    const inside = next.pages.find((page) => page.name === "inside-right")!;
    expect(inside.elements).toHaveLength(1);
    expect(inside.elements[0]).toMatchObject({
      kind: "text",
      id: SEEDED_MESSAGE_ELEMENT_ID,
      text: "Happy birthday {firstName}",
    });
  });

  it("writes it where the catalog would have put it", () => {
    // Pinned against the builder so a card that never had a message ends up
    // looking like one that did, rather than drifting apart from it.
    const seeded = buildCardDocument(null, "Anything");
    const seededBlock = seeded.pages.find((page) => page.name === "inside-right")!.elements[0]!;
    const written = applyCardMessage(withInsideRight([]), "Anything");
    const writtenBlock = written.pages.find((page) => page.name === "inside-right")!.elements[0]!;
    expect(writtenBlock).toEqual(seededBlock);
  });

  it("does not write a block onto a document with no inside page", () => {
    const document: DesignDocument = { version: 1, pages: [{ name: "front", elements: [] }] };
    expect(applyCardMessage(document, "Happy birthday")).toEqual(document);
  });

  it("does not modify the design it was given", () => {
    // The saved design is the customer's and is shared by every card made from
    // it; only the per-card snapshot may carry a chosen message.
    const document = buildCardDocument("https://art.test/a.png", "Happy Birthday!");
    const snapshot = JSON.stringify(document);
    applyCardMessage(document, "Something else entirely");
    expect(JSON.stringify(document)).toBe(snapshot);
  });

  it("keeps merge tokens intact for the print-time substitution", () => {
    // The pool holds tokens, not names — which is what lets a model help write
    // these without anybody's contacts leaving the platform (ADR 0256).
    const document = buildCardDocument("https://art.test/a.png", "Happy Birthday!");
    const next = applyCardMessage(document, "Happy birthday {firstName}!");
    const inside = next.pages.find((page) => page.name === "inside-right")!;
    expect(inside.elements[0]).toMatchObject({ text: "Happy birthday {firstName}!" });
  });
});
