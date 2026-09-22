import {
  pickStandingOrderDesign,
  pickStandingOrderMessage,
  type PoolDesign,
} from "./standing-order-pick";

function design(savedDesignId: string, ageBand: PoolDesign["ageBand"] = null): PoolDesign {
  return { savedDesignId, ageBand };
}

const POOL = [design("a"), design("b"), design("c"), design("d")];
const MESSAGES = ["m1", "m2", "m3", "m4"];

function date(year: number): Date {
  return new Date(Date.UTC(year, 5, 14));
}

describe("picking a design from the pool", () => {
  it("always picks something the subscriber actually chose", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(["a", "b", "c", "d"]).toContain(
        pickStandingOrderDesign(POOL, `recipient-${index}`, date(2026)),
      );
    }
  });

  it("gives the same card for the same person and year", () => {
    const first = pickStandingOrderDesign(POOL, "recipient-1", date(2026));
    expect(pickStandingOrderDesign(POOL, "recipient-1", date(2026))).toBe(first);
  });

  it("does not send the same person the same card next year", () => {
    const changed = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"].filter(
      (id) =>
        pickStandingOrderDesign(POOL, id, date(2026)) !==
        pickStandingOrderDesign(POOL, id, date(2027)),
    );
    // Not all of them — with four designs a collision is a one-in-four chance,
    // and a test claiming otherwise would be a test that lies.
    expect(changed.length).toBeGreaterThanOrEqual(6);
  });

  it("spreads people across the pool rather than giving everybody the first one", () => {
    const chosen = new Set(
      Array.from({ length: 100 }, (_, index) =>
        pickStandingOrderDesign(POOL, `recipient-${index}`, date(2026)),
      ),
    );
    expect(chosen.size).toBe(POOL.length);
  });

  it("copes with a pool of one, and refuses an empty one", () => {
    expect(pickStandingOrderDesign([design("only")], "anyone", date(2026))).toBe("only");
    // Reaching here is a bug — the caller refuses to run an empty instruction —
    // and returning undefined would queue a card with no artwork.
    expect(() => pickStandingOrderDesign([], "anyone", date(2026))).toThrow();
  });

  it("does not depend on the day of the year, only the year", () => {
    // A birthday that shifts by a day — a leap year, a corrected date of birth
    // — must not change the card.
    expect(pickStandingOrderDesign(POOL, "r1", new Date(Date.UTC(2026, 11, 2)))).toBe(
      pickStandingOrderDesign(POOL, "r1", new Date(Date.UTC(2026, 5, 14))),
    );
  });

  describe("when the catalog has described itself", () => {
    const MIXED = [
      design("child-1", "child"),
      design("child-2", "child"),
      design("anyone", "any"),
      design("adult", "adult"),
      design("undescribed", null),
    ];

    it("gives a child a card meant for a child", () => {
      for (let index = 0; index < 50; index += 1) {
        expect(["child-1", "child-2"]).toContain(
          pickStandingOrderDesign(MIXED, `r${index}`, date(2026), "child"),
        );
      }
    });

    it("falls back to a card for anybody when nothing matches the band", () => {
      const pool = [design("anyone", "any"), design("adult", "adult"), design("nothing", null)];
      expect(pickStandingOrderDesign(pool, "r1", date(2026), "child")).toBe("anyone");
    });

    it("prefers an undescribed card over one marked for a different age", () => {
      // Silence is a smaller risk than a card somebody explicitly marked for
      // somebody else's age.
      const pool = [design("adult", "adult"), design("undescribed", null)];
      expect(pickStandingOrderDesign(pool, "r1", date(2026), "child")).toBe("undescribed");
    });

    it("prefers a card for anybody when the recipient's age is unknown", () => {
      // The common case: birthYearKnown is false for every CleanCloud contact.
      const pool = [design("child", "child"), design("anyone", "any")];
      expect(pickStandingOrderDesign(pool, "r1", date(2026), null)).toBe("anyone");
    });

    it("still sends a card when every design is for one age and we do not know theirs", () => {
      // A nursery whose whole pool is children's cards must not stop sending
      // because one contact has no birth year. Prefer, never exclude.
      const pool = [design("child-1", "child"), design("child-2", "child")];
      expect(["child-1", "child-2"]).toContain(
        pickStandingOrderDesign(pool, "r1", date(2026), null),
      );
    });
  });
});

describe("picking a message from the pool", () => {
  it("always picks one the subscriber wrote, and refuses an empty pool", () => {
    expect(MESSAGES).toContain(pickStandingOrderMessage(MESSAGES, "r1", date(2026)));
    expect(() => pickStandingOrderMessage([], "r1", date(2026))).toThrow();
  });

  it("varies by person and by year, like the design does", () => {
    const people = new Set(
      Array.from({ length: 100 }, (_, i) =>
        pickStandingOrderMessage(MESSAGES, `r${i}`, date(2026)),
      ),
    );
    expect(people.size).toBe(MESSAGES.length);
    expect(pickStandingOrderMessage(MESSAGES, "r1", date(2026))).toBe(
      pickStandingOrderMessage(MESSAGES, "r1", date(2026)),
    );
  });

  it("does not move in lockstep with the design pick", () => {
    // Salted differently on purpose. With one seed, four designs and four
    // messages would only ever produce four of the sixteen pairings, and the
    // same person would get the same combination every year the pools matched.
    const pairs = new Set(
      Array.from({ length: 200 }, (_, index) => {
        const id = `r${index}`;
        return `${pickStandingOrderDesign(POOL, id, date(2026))}|${pickStandingOrderMessage(
          MESSAGES,
          id,
          date(2026),
        )}`;
      }),
    );
    expect(pairs.size).toBeGreaterThan(POOL.length);
  });
});
