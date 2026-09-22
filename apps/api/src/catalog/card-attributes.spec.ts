import {
  CARD_AGE_BAND_VALUES,
  CARD_TONE_VALUES,
  parseCardAgeBand,
  parseCardTone,
} from "@kudos/shared-types";

/**
 * The vocabulary a person types into Airtable, and what we store.
 *
 * Tolerant on the way in for the same reason the column names are: these cells
 * are filled in by hand across a couple of hundred rows, and "Kids" meaning
 * `child` is not worth failing a sync over. Anything genuinely unrecognised
 * stays null and is reported rather than guessed at — a guess here picks the
 * card a real person receives.
 */
describe("card attribute vocabulary", () => {
  it("accepts its own values back", () => {
    for (const value of CARD_AGE_BAND_VALUES) {
      expect(parseCardAgeBand(value)).toBe(value);
    }
    for (const value of CARD_TONE_VALUES) {
      expect(parseCardTone(value)).toBe(value);
    }
  });

  it("does not care how somebody capitalised or spaced it", () => {
    expect(parseCardAgeBand("  Child ")).toBe("child");
    expect(parseCardAgeBand("ANY AGE")).toBe("any");
    expect(parseCardTone("Humour")).toBe("funny");
  });

  it("understands the words an operator would actually type", () => {
    expect(parseCardAgeBand("Kids")).toBe("child");
    expect(parseCardAgeBand("Teenager")).toBe("teen");
    expect(parseCardAgeBand("18+")).toBe("adult");
    expect(parseCardAgeBand("All ages")).toBe("any");
    expect(parseCardTone("Heartfelt")).toBe("warm");
    expect(parseCardTone("Classic")).toBe("elegant");
    expect(parseCardTone("Minimal")).toBe("simple");
  });

  it("refuses to guess at something it does not know", () => {
    // The alternative is a card chosen for a real person on a guess. Null is
    // reported by the sync, so the operator finds out; a wrong guess is not.
    expect(parseCardAgeBand("Middle-aged")).toBeNull();
    expect(parseCardAgeBand("40th")).toBeNull();
    expect(parseCardTone("Christmassy")).toBeNull();
  });

  it("treats an empty cell as undescribed, not as a value", () => {
    // Null and `any` are deliberately different: null is nobody having looked,
    // `any` is somebody saying it suits everybody.
    expect(parseCardAgeBand("")).toBeNull();
    expect(parseCardAgeBand("   ")).toBeNull();
    expect(parseCardAgeBand(null)).toBeNull();
    expect(parseCardAgeBand(undefined)).toBeNull();
    expect(parseCardTone("")).toBeNull();
  });

  it("never maps anything onto a value outside the vocabulary", () => {
    // The Prisma enums are these lists; a parser that returned a fifth value
    // would fail at the database rather than here.
    const ages: unknown[] = [...CARD_AGE_BAND_VALUES];
    const tones: unknown[] = [...CARD_TONE_VALUES];
    for (const typed of ["Kids", "Teenager", "18+", "All ages", "general", "grown up"]) {
      const parsed = parseCardAgeBand(typed);
      if (parsed !== null) expect(ages).toContain(parsed);
    }
    for (const typed of ["Humour", "Classic", "Minimal", "Sincere", "Luxury", "Modern"]) {
      const parsed = parseCardTone(typed);
      if (parsed !== null) expect(tones).toContain(parsed);
    }
  });
});
