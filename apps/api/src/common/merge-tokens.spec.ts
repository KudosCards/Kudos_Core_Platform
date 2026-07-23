import { applyMergeText, applyMergeTokens, hasMergeTokens } from "@kudos/shared-types";
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
});
