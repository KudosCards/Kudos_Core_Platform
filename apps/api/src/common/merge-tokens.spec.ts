import {
  MERGE_FIELDS,
  MERGE_TOKENS,
  applyMergeText,
  applyMergeTokens,
  findBracketTokenMistakes,
  findDesignBracketTokenMistakes,
  fixBracketTokens,
  fixDesignBracketTokens,
  hasMergeTokens,
} from "@kudos/shared-types";
import type { DesignDocument } from "@kudos/shared-types";

const recipient = { firstName: "Ada", lastName: "Lovelace" };

describe("merge tokens", () => {
  describe("applyMergeText", () => {
    it("substitutes {name} and {firstName} with the first name", () => {
      expect(applyMergeText("Dear {name},", recipient)).toBe("Dear Ada,");
      expect(applyMergeText("Hi {firstName}", recipient)).toBe("Hi Ada");
    });

    it("substitutes {lastName} and {fullName}", () => {
      expect(applyMergeText("Ms {lastName}", recipient)).toBe("Ms Lovelace");
      expect(applyMergeText("To {fullName}", recipient)).toBe("To Ada Lovelace");
    });

    it("is case-insensitive on the token name", () => {
      expect(applyMergeText("{Name} {NAME}", recipient)).toBe("Ada Ada");
    });

    it("leaves unknown tokens untouched", () => {
      expect(applyMergeText("Order {code} for {name}", recipient)).toBe("Order {code} for Ada");
    });

    it("resolves {occasion} and {occasionDate}/{date} from the context", () => {
      const ctx = { ...recipient, occasion: "Graduation", occasionDate: "2026-07-25" };
      expect(applyMergeText("Congratulations on your {occasion}", ctx)).toBe(
        "Congratulations on your Graduation",
      );
      expect(applyMergeText("on {occasionDate}", ctx)).toBe("on 25 Jul 2026");
      expect(applyMergeText("on {date}", ctx)).toBe("on 25 Jul 2026");
    });

    it("leaves occasion tokens untouched when there's no occasion in context", () => {
      expect(applyMergeText("For your {occasion}", recipient)).toBe("For your {occasion}");
      expect(applyMergeText("On {occasionDate}", recipient)).toBe("On {occasionDate}");
    });

    it("resolves custom fields case-insensitively, with built-ins winning", () => {
      const ctx = {
        ...recipient,
        customFields: { teacher: "Mrs Patel", firstName: "SHOULD-NOT-WIN" },
      };
      expect(applyMergeText("From {teacher}", ctx)).toBe("From Mrs Patel");
      expect(applyMergeText("From {TEACHER}", ctx)).toBe("From Mrs Patel");
      // Built-in {firstName} wins over a custom field of the same name.
      expect(applyMergeText("Hi {firstName}", ctx)).toBe("Hi Ada");
    });
  });

  describe("applyMergeTokens", () => {
    const doc: DesignDocument = {
      version: 1,
      pages: [
        {
          name: "front",
          elements: [
            { kind: "text", id: "t1", text: "Happy birthday {name}!", x: 20, y: 20, fontFamily: "Inter", fontSize: 24, color: "#000" },
            { kind: "image", id: "i1", assetUrl: "https://cdn.example.com/a.png", x: 0, y: 0, width: 450, height: 600, rotation: 0 },
          ],
        },
        { name: "inside-left", elements: [] },
      ],
    };

    it("resolves text tokens and leaves images untouched, without mutating the input", () => {
      const merged = applyMergeTokens(doc, recipient);
      const front = merged.pages[0]!;
      expect((front.elements[0] as { text: string }).text).toBe("Happy birthday Ada!");
      expect(front.elements[1]).toEqual(doc.pages[0]!.elements[1]); // image unchanged
      // Original document is not mutated.
      expect((doc.pages[0]!.elements[0] as { text: string }).text).toBe("Happy birthday {name}!");
    });

    it("hasMergeTokens detects personalisable designs", () => {
      expect(hasMergeTokens(doc)).toBe(true);
      expect(
        hasMergeTokens({ version: 1, pages: [{ name: "front", elements: [] }] }),
      ).toBe(false);
    });
  });

  describe("MERGE_FIELDS (editor 'Insert merge field' menu)", () => {
    it("offers only tokens that are recognised built-ins", () => {
      for (const field of MERGE_FIELDS) {
        expect(MERGE_TOKENS as readonly string[]).toContain(field.token);
      }
    });

    it("each field's token actually resolves at send time", () => {
      const ctx = {
        ...recipient,
        occasion: "Graduation",
        occasionDate: "2026-07-25",
      };
      for (const field of MERGE_FIELDS) {
        // Inserting the token and merging must change the text — i.e. it's live,
        // not a literal the recipient would see.
        expect(applyMergeText(field.token, ctx)).not.toBe(field.token);
      }
    });

    it("has a non-empty, human label for every field", () => {
      for (const field of MERGE_FIELDS) {
        expect(field.label.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("bracket-token mistakes", () => {
    it("finds common [name]-style mistakes and their curly suggestion", () => {
      expect(findBracketTokenMistakes("To [insert name], happy birthday")).toEqual([
        { found: "[insert name]", suggestion: "{name}" },
      ]);
      expect(findBracketTokenMistakes("Dear [First Name] [Last Name]")).toEqual([
        { found: "[First Name]", suggestion: "{firstName}" },
        { found: "[Last Name]", suggestion: "{lastName}" },
      ]);
    });

    it("ignores brackets that aren't known token phrases", () => {
      expect(findBracketTokenMistakes("See [note 4] and [name]")).toEqual([
        { found: "[name]", suggestion: "{name}" },
      ]);
    });

    it("deduplicates repeated identical mistakes", () => {
      expect(findBracketTokenMistakes("[name] and again [name]")).toEqual([
        { found: "[name]", suggestion: "{name}" },
      ]);
    });

    it("fixBracketTokens rewrites recognised mistakes and leaves others alone", () => {
      expect(fixBracketTokens("To [insert name] — see [note 4]")).toBe(
        "To {name} — see [note 4]",
      );
    });

    it("finds and fixes bracket mistakes across a whole design's text", () => {
      const bad: DesignDocument = {
        version: 1,
        pages: [
          {
            name: "front",
            elements: [
              { kind: "text", id: "t1", text: "Dear [name],", x: 0, y: 0, fontFamily: "Inter", fontSize: 24, color: "#000" },
              { kind: "image", id: "i1", assetUrl: "https://cdn.example.com/a.png", x: 0, y: 0, width: 1, height: 1, rotation: 0 },
            ],
          },
          {
            name: "inside-left",
            elements: [
              { kind: "text", id: "t2", text: "From [the occasion]", x: 0, y: 0, fontFamily: "Inter", fontSize: 24, color: "#000" },
            ],
          },
        ],
      };
      expect(findDesignBracketTokenMistakes(bad)).toEqual([
        { found: "[name]", suggestion: "{name}" },
        { found: "[the occasion]", suggestion: "{occasion}" },
      ]);
      const fixed = fixDesignBracketTokens(bad);
      expect((fixed.pages[0]!.elements[0] as { text: string }).text).toBe("Dear {name},");
      expect((fixed.pages[1]!.elements[0] as { text: string }).text).toBe("From {occasion}");
      expect(fixed.pages[0]!.elements[1]).toEqual(bad.pages[0]!.elements[1]); // image untouched
      // Original not mutated.
      expect((bad.pages[0]!.elements[0] as { text: string }).text).toBe("Dear [name],");
      expect(findDesignBracketTokenMistakes(fixed)).toEqual([]);
    });
  });
});
