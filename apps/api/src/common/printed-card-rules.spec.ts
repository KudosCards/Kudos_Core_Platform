import type { DesignDocument } from "@kudos/shared-types";
import {
  applyMergeTokens,
  CARD_FACE_ORDER,
  facesOf,
  mergeCustomFields,
  occasionLabel,
  printedCardMergeContext,
} from "@kudos/shared-types";

/**
 * The rules that decide what actually gets printed on a card, pinned in one
 * place because they used to exist in two.
 *
 * `facesOf`, `occasionLabel` and the merge context were each written twice —
 * once in the browser preview and once in the PDF service, the second carrying a
 * comment promising it matched the first. The PDF is the copy that reaches a
 * customer, so any drift between them is a card that does not look like its
 * preview. That is the exact fault the preview exists to prevent.
 */

const doc = (names: string[]): DesignDocument =>
  ({ version: 1, pages: names.map((name) => ({ name, elements: [] })) }) as DesignDocument;

describe("facesOf", () => {
  it("returns the faces in the order they are read and printed", () => {
    // Authored out of order on purpose: the page array's order is not the print
    // order, and a PDF that printed the inside before the cover would be bound
    // back to front.
    expect(facesOf(doc(["back", "inside-right", "front", "inside-left"]))).toEqual([
      "front",
      "inside-left",
      "inside-right",
      "back",
    ]);
  });

  it("returns only the faces a design actually has", () => {
    expect(facesOf(doc(["front"]))).toEqual(["front"]);
    expect(facesOf(doc(["front", "back"]))).toEqual(["front", "back"]);
  });

  it("reads an unparseable document as no faces rather than throwing", () => {
    expect(facesOf(null)).toEqual([]);
    expect(facesOf({} as DesignDocument)).toEqual([]);
  });

  it("agrees with the canonical order it is filtered from", () => {
    expect(facesOf(doc([...CARD_FACE_ORDER]))).toEqual(CARD_FACE_ORDER);
  });
});

describe("occasionLabel", () => {
  it("prefers a custom title over the type", () => {
    expect(occasionLabel({ occasionTitle: "Leavers 2026", occasionType: "birthday" })).toBe(
      "Leavers 2026",
    );
  });

  it("title-cases the type when there is no custom title", () => {
    expect(occasionLabel({ occasionTitle: null, occasionType: "birthday" })).toBe("Birthday");
  });

  it("is null when there is no occasion at all", () => {
    expect(occasionLabel({ occasionTitle: null, occasionType: null })).toBeNull();
    expect(occasionLabel({})).toBeNull();
  });

  it("treats an empty title as no title rather than printing nothing", () => {
    expect(occasionLabel({ occasionTitle: "", occasionType: "anniversary" })).toBe("Anniversary");
  });
});

describe("mergeCustomFields", () => {
  it("keeps strings as they are", () => {
    expect(mergeCustomFields({ tutor: "Mrs Hale" })).toEqual({ tutor: "Mrs Hale" });
  });

  it("stringifies the scalars the JSON column can hold", () => {
    // The recipients endpoint validates this column as an object and nothing
    // more, so the declared Record<string, string> is a claim, not a fact.
    expect(mergeCustomFields({ year: 7, gold: true })).toEqual({ year: "7", gold: "true" });
  });

  it("drops anything that has no sensible printed form", () => {
    // The divergence this closes: the PDF dropped these and the preview passed
    // them through, so a nested field previewed as "[object Object]" and printed
    // as an unresolved token. Dropping is the right half — an unresolved token
    // is what the pre-send check already reports.
    expect(mergeCustomFields({ nested: { a: 1 }, list: [1, 2], nothing: null })).toEqual({});
  });

  it("reads a non-object as no fields at all", () => {
    expect(mergeCustomFields(null)).toBeNull();
    expect(mergeCustomFields("Mrs Hale")).toBeNull();
    expect(mergeCustomFields([1, 2])).toBeNull();
  });
});

describe("printedCardMergeContext", () => {
  const facts = {
    recipientFirstName: "Elise",
    recipientLastName: "Bisby",
    occasionTitle: null,
    occasionType: "birthday",
    occasionDate: "2026-09-18",
    recipientCustomFields: { tutor: "Mrs Hale", year: 7 },
  };

  it("builds the one context both the preview and the PDF merge with", () => {
    expect(printedCardMergeContext(facts)).toEqual({
      firstName: "Elise",
      lastName: "Bisby",
      occasion: "Birthday",
      occasionDate: "2026-09-18",
      customFields: { tutor: "Mrs Hale", year: "7" },
    });
  });

  it("resolves the same tokens on a real document", () => {
    const card = {
      version: 1,
      pages: [
        {
          name: "inside-right",
          elements: [
            {
              kind: "text",
              id: "t1",
              text: "To {firstName}, {occasion} from {tutor} in year {year}",
              x: 40,
              y: 40,
              width: 300,
              fontSize: 18,
              fontFamily: "Helvetica",
              color: "#000000",
            },
          ],
        },
      ],
    } as unknown as DesignDocument;

    const merged = applyMergeTokens(card, printedCardMergeContext(facts));
    const text = (merged.pages[0]!.elements[0] as { text: string }).text;
    expect(text).toBe("To Elise, Birthday from Mrs Hale in year 7");
  });
});
