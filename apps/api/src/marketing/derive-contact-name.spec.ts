import { deriveContactName } from "./derive-contact-name";

describe("deriveContactName", () => {
  describe("organisation", () => {
    it("maps the name to the company, leaving person names empty", () => {
      expect(deriveContactName("organisation", "Sunrise Care Home")).toEqual({
        company: "Sunrise Care Home",
      });
    });

    it("trims and collapses whitespace", () => {
      expect(deriveContactName("organisation", "  Acme   Ltd  ")).toEqual({ company: "Acme Ltd" });
    });
  });

  describe("individual", () => {
    it("splits first + last on the last space", () => {
      expect(deriveContactName("individual", "Jane Smith")).toEqual({
        firstName: "Jane",
        lastName: "Smith",
      });
    });

    it("keeps multi-word given names with the first name and the surname as the last token", () => {
      expect(deriveContactName("individual", "Mary Jane Watson")).toEqual({
        firstName: "Mary Jane",
        lastName: "Watson",
      });
    });

    it("treats a single token as a first name with no surname", () => {
      expect(deriveContactName("individual", "Cher")).toEqual({ firstName: "Cher" });
    });

    it("collapses inner whitespace before splitting", () => {
      expect(deriveContactName("individual", "  John   Doe  ")).toEqual({
        firstName: "John",
        lastName: "Doe",
      });
    });
  });

  it("returns nothing for a blank name", () => {
    expect(deriveContactName("individual", "   ")).toEqual({});
    expect(deriveContactName("organisation", "")).toEqual({});
  });
});
