import { duplicateNames, duplicateSkus, unpublishedCategories } from "./catalog-data-quality";

/**
 * A product code on more than one card.
 *
 * Nothing in the platform is keyed on `sku` — the sync upserts on the Airtable
 * record id, and a card's URL comes from its name — so a duplicate breaks
 * nothing. What it breaks is the *report*: every ops surface lists a card as
 * "Title (SKU)", and the artwork worklist that comes out of this sync is a list
 * of codes. Three rows sharing `KC-INSPIRATIONAL-GEN-011` — a Lewis Carroll and
 * a Henry Fielding among them — cannot be handed to anybody as a brief.
 */
const card = (externalId: string, title: string, sku: string | null, category = "birthday") => ({
  externalId,
  title,
  sku,
  category,
});

describe("duplicateSkus", () => {
  it("names every card sharing a code", () => {
    const found = duplicateSkus([
      card("rec1", "Lewis Carroll - Cards", "KC-INSPIRATIONAL-GEN-011"),
      card("rec2", "Henry Fielding Habits", "KC-INSPIRATIONAL-GEN-011"),
      card("rec3", "Jane Austen", "KC-INSPIRATIONAL-GEN-009"),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.sku).toBe("KC-INSPIRATIONAL-GEN-011");
    expect(found[0]?.designs.map((d) => d.title)).toEqual([
      "Lewis Carroll - Cards",
      "Henry Fielding Habits",
    ]);
  });

  it("says nothing when every code is its own", () => {
    expect(duplicateSkus([card("rec1", "A", "KC-A-001"), card("rec2", "B", "KC-B-001")])).toEqual(
      [],
    );
  });

  it("does not treat a missing code as a shared one", () => {
    // The discriminator that matters most. Seeded templates and any Airtable row
    // with the column empty have no SKU, and grouping them would report every
    // one of them as a duplicate of all the others — a false alarm the size of
    // the catalog, on the very first sync.
    expect(
      duplicateSkus([
        card("rec1", "A", null),
        card("rec2", "B", null),
        card("rec3", "C", "   "),
        card("rec4", "D", ""),
      ]),
    ).toEqual([]);
  });

  it("treats the same code written differently as the same code", () => {
    // A product code is a product code whatever the casing or stray spaces a
    // spreadsheet left on it. Matched loosely, but reported as it was typed, so
    // an operator can find the row.
    const found = duplicateSkus([
      card("rec1", "A", "KC-BDAY-GEN-007"),
      card("rec2", "B", " kc-bday-gen-007 "),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.sku).toBe("KC-BDAY-GEN-007");
    expect(found[0]?.designs).toHaveLength(2);
  });

  it("puts the worst tangle first", () => {
    const found = duplicateSkus([
      card("rec1", "A", "KC-TWO"),
      card("rec2", "B", "KC-TWO"),
      card("rec3", "C", "KC-THREE"),
      card("rec4", "D", "KC-THREE"),
      card("rec5", "E", "KC-THREE"),
    ]);

    expect(found.map((f) => f.sku)).toEqual(["KC-THREE", "KC-TWO"]);
  });
});

/**
 * The one with a permanent, customer-visible consequence.
 *
 * A slug is derived from the name and assigned **once** — recomputing it would
 * break every indexed URL and every QR code already in the post (ADR 0163). So
 * when two names collide, the loser carries `-2` for good.
 */
describe("duplicateNames", () => {
  it("names the cards that will collide on their URL", () => {
    const found = duplicateNames([
      card("rec1", "Well Done - Flowers", "KC-WELL DONE-GEN-001"),
      card("rec2", "Well Done - Flowers", "KC-WELL DONE-GEN-006"),
      card("rec3", "Well Done - Rainbow", "KC-WELL DONE-GEN-018"),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.slug).toBe("well-done-flowers");
    expect(found[0]?.designs).toHaveLength(2);
  });

  it("collides on the slug, not on the spelling", () => {
    // The discriminator, and the reason this is grouped by slug at all. These
    // are three different strings and one address, so comparing raw names would
    // report nothing while the collision still happened.
    const found = duplicateNames([
      card("rec1", "Well Done — Flowers", null),
      card("rec2", "well done flowers", null),
      card("rec3", "Well Done, Flowers!", null),
    ]);

    expect(found).toHaveLength(1);
    expect(found[0]?.designs).toHaveLength(3);
  });

  it("says nothing when every name is its own address", () => {
    expect(duplicateNames([card("rec1", "A", null), card("rec2", "B", null)])).toEqual([]);
  });

  it("ignores names that slugify to nothing", () => {
    // These fall back to the SKU and then the record id, so they never collide
    // on the name — reporting them would be a warning about something that
    // cannot happen.
    expect(duplicateNames([card("rec1", "!!!", null), card("rec2", "???", null)])).toEqual([]);
  });
});

/**
 * Not a defect report — a list of landing pages the catalog is asking for.
 */
describe("unpublishedCategories", () => {
  it("counts the cards with no category page to sit on", () => {
    const found = unpublishedCategories([
      card("rec1", "A", null, "christmas"),
      card("rec2", "B", null, "christmas"),
      card("rec3", "C", null, "easter"),
      card("rec4", "D", null, "birthday"),
    ]);

    expect(found).toEqual([
      { category: "christmas", count: 2 },
      { category: "easter", count: 1 },
    ]);
  });

  it("does not report a category that publishes, however it is written", () => {
    // The discriminator. The vocabulary matches aliases and folds case and
    // separators, so reporting on a raw-string comparison would flag categories
    // that have a perfectly good landing page.
    expect(
      unpublishedCategories([
        card("rec1", "A", null, "Thank_You"),
        card("rec2", "B", null, "well done"),
        card("rec3", "C", null, "Birthdays"),
        card("rec4", "D", null, "exam"),
        card("rec5", "E", null, "humour"),
      ]),
    ).toEqual([]);
  });

  it("puts the biggest missing page first", () => {
    const found = unpublishedCategories([
      card("rec1", "A", null, "eid"),
      card("rec2", "B", null, "christmas"),
      card("rec3", "C", null, "christmas"),
    ]);
    expect(found.map((c) => c.category)).toEqual(["christmas", "eid"]);
  });
});
