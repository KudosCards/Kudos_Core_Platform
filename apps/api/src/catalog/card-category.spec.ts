import {
  CARD_CATEGORIES,
  cardCategoryLabel,
  getCardCategory,
  resolveCardCategory,
  slugifyCardName,
  uniqueCardSlug,
} from "@kudos/shared-types";

/**
 * The catalog's `category` is uncontrolled upstream text and card slugs become
 * permanent public URLs, so both the vocabulary matching and the slug derivation
 * are pinned here. See docs/adr/0163-catalog-urls-and-category-pages.md.
 */

describe("card category vocabulary", () => {
  it("has unique slugs, and slugs that are themselves URL-safe", () => {
    const slugs = CARD_CATEGORIES.map((category) => category.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("never lets two categories claim the same alias", () => {
    const claims = CARD_CATEGORIES.flatMap((category) => category.aliases);
    expect(new Set(claims).size).toBe(claims.length);
  });

  it("resolves the upstream spellings the Airtable sync actually produces", () => {
    // The sync lowercases whatever ops typed, so these are all real shapes.
    expect(resolveCardCategory("birthday")?.slug).toBe("birthday");
    expect(resolveCardCategory("Birthday")?.slug).toBe("birthday");
    expect(resolveCardCategory("thank you")?.slug).toBe("thank-you");
    expect(resolveCardCategory("thank_you")?.slug).toBe("thank-you");
    expect(resolveCardCategory("Thank You ")?.slug).toBe("thank-you");
    expect(resolveCardCategory("well done")?.slug).toBe("congratulations");
  });

  it("returns undefined for anything unrecognised rather than guessing", () => {
    // A typo must stay unpublished, not land in the nearest bucket.
    expect(resolveCardCategory("tank you")).toBeUndefined();
    expect(resolveCardCategory("uncategorised")).toBeUndefined();
    expect(resolveCardCategory("")).toBeUndefined();
    expect(resolveCardCategory("   ")).toBeUndefined();
  });

  it("labels known categories from the vocabulary and tidies unknown ones", () => {
    expect(cardCategoryLabel("thank_you")).toBe("Thank You");
    // The old charAt(0).toUpperCase() helper would have shown "Thank_you".
    expect(cardCategoryLabel("seasonal_greetings")).toBe("Seasonal Greetings");
    expect(cardCategoryLabel("  ")).toBe("Uncategorised");
  });

  it("looks a category up by its canonical slug only", () => {
    expect(getCardCategory("thank-you")?.name).toBe("Thank You");
    expect(getCardCategory("thank_you")).toBeUndefined();
  });

  it("gives every category landing-page copy", () => {
    for (const category of CARD_CATEGORIES) {
      expect(category.title.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
    }
  });
});

describe("slugifyCardName", () => {
  it("makes a readable URL segment from a design name", () => {
    expect(slugifyCardName("Simple Happy Birthday Fun")).toBe("simple-happy-birthday-fun");
    expect(slugifyCardName("Happy Birthday - Balloons")).toBe("happy-birthday-balloons");
  });

  it("handles punctuation, ampersands and apostrophes", () => {
    expect(slugifyCardName("Mum & Dad's Anniversary!")).toBe("mum-and-dads-anniversary");
    expect(slugifyCardName("Well Done!!!")).toBe("well-done");
  });

  it("folds accents rather than dropping the word", () => {
    expect(slugifyCardName("Fête Card")).toBe("fete-card");
  });

  it("returns an empty string when nothing usable survives, so callers fall back", () => {
    expect(slugifyCardName("!!!")).toBe("");
    expect(slugifyCardName("   ")).toBe("");
  });

  it("caps length without leaving a trailing separator", () => {
    const slug = slugifyCardName("word ".repeat(40));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("uniqueCardSlug", () => {
  it("returns the base slug when it's free", () => {
    expect(uniqueCardSlug("birthday-balloons", new Set())).toBe("birthday-balloons");
  });

  it("suffixes past every collision", () => {
    const taken = new Set(["birthday-balloons", "birthday-balloons-2"]);
    expect(uniqueCardSlug("birthday-balloons", taken)).toBe("birthday-balloons-3");
  });

  it("refuses an empty base rather than minting '-2'", () => {
    expect(() => uniqueCardSlug("", new Set())).toThrow();
  });
});
