import {
  describeSendSchedule,
  orderScheduleIsLive,
  summariseSendSchedule,
  tallyCardStatuses,
} from "@kudos/shared-types";

/**
 * The order page's send readout.
 *
 * The behaviour under test is the one a customer complained about: an order page
 * that names a single post date. That was only ever right when every card in an
 * order went on the same day, which stopped being true once bulk sends became
 * occasion-timed (ADR 0160) and a segment send started posting each card ahead
 * of its own recipient's date.
 *
 * The old readout was `lines.find((l) => l.dispatchDate)?.dispatchDate` — the
 * first dated line, presented as the whole order's date. Nearly every case below
 * is chosen to be one that expression gets wrong.
 */
describe("summariseSendSchedule", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const card = (status: string, dispatchDate: Date | string | null) => ({ status, dispatchDate });

  it("reports the one date when every card shares it", () => {
    const s = summariseSendSchedule([
      card("queued", d("2026-09-04")),
      card("queued", d("2026-09-04")),
      card("queued", d("2026-09-04")),
    ]);
    expect(s.dates).toEqual([d("2026-09-04")]);
    expect(s.isSpread).toBe(false);
    expect(s.toCome).toBe(3);
  });

  it("reports every distinct date on an occasion-timed order, soonest first", () => {
    // Deliberately out of order, and with a duplicate: two people can share a
    // birthday, and that is one date to report, not two.
    const s = summariseSendSchedule([
      card("queued", d("2026-11-02")),
      card("queued", d("2026-09-04")),
      card("queued", d("2026-10-15")),
      card("queued", d("2026-09-04")),
    ]);
    expect(s.dates).toEqual([d("2026-09-04"), d("2026-10-15"), d("2026-11-02")]);
    expect(s.isSpread).toBe(true);
    expect(s.earliest).toEqual(d("2026-09-04"));
    expect(s.latest).toEqual(d("2026-11-02"));
    expect(s.toCome).toBe(4);
  });

  it("keeps reporting the cards still to come after the earliest one has posted", () => {
    // The old readout took the first dated line. Once that card posted, its date
    // was in the past, the page decided the order was no longer scheduled, and
    // the banner vanished — while five cards were still waiting to go.
    const s = summariseSendSchedule([
      card("posted", d("2026-09-04")),
      card("queued", d("2026-10-15")),
      card("queued", d("2026-11-02")),
    ]);
    expect(s.gone).toBe(1);
    expect(s.toCome).toBe(2);
    expect(s.dates).toEqual([d("2026-10-15"), d("2026-11-02")]);
    expect(s.earliest).toEqual(d("2026-10-15"));
  });

  it("does not count a delivered or returned card as still to come", () => {
    const s = summariseSendSchedule([
      card("delivered", d("2026-09-04")),
      card("returned_to_sender", d("2026-09-04")),
      card("queued", d("2026-10-15")),
    ]);
    expect(s.gone).toBe(2);
    expect(s.toCome).toBe(1);
  });

  it("ignores cancelled cards entirely", () => {
    // A cancelled card isn't going and isn't gone. Counting it either way would
    // tell the customer they're waiting on a card that no longer exists.
    const s = summariseSendSchedule([
      card("cancelled", d("2026-09-04")),
      card("queued", d("2026-10-15")),
    ]);
    expect(s.toCome).toBe(1);
    expect(s.gone).toBe(0);
    expect(s.dates).toEqual([d("2026-10-15")]);
  });

  it("counts undated cards separately rather than hiding them", () => {
    // A mixed segment send: some recipients have a birthday on file, some don't.
    // The composer already warns about this before paying; the order page has to
    // agree with it afterwards.
    const s = summariseSendSchedule([
      card("queued", d("2026-10-15")),
      card("queued", null),
      card("queued", null),
    ]);
    expect(s.toCome).toBe(3);
    expect(s.undated).toBe(2);
    expect(s.dates).toEqual([d("2026-10-15")]);
    expect(s.isSpread).toBe(false);
  });

  it("treats an unparseable date as undated rather than reporting Invalid Date", () => {
    const s = summariseSendSchedule([card("queued", "not-a-date")]);
    expect(s.undated).toBe(1);
    expect(s.dates).toEqual([]);
    expect(s.earliest).toBeNull();
  });

  it("accepts ISO strings, since that is what the API serialises", () => {
    const s = summariseSendSchedule([
      card("queued", "2026-10-15T00:00:00.000Z"),
      card("queued", "2026-09-04T00:00:00.000Z"),
    ]);
    expect(s.dates).toEqual([d("2026-09-04"), d("2026-10-15")]);
    expect(s.isSpread).toBe(true);
  });

  it("is empty for an order with nothing left to send", () => {
    const s = summariseSendSchedule([card("posted", d("2026-09-04"))]);
    expect(s.toCome).toBe(0);
    expect(s.dates).toEqual([]);
    expect(s.earliest).toBeNull();
    expect(s.latest).toBeNull();
    expect(s.isSpread).toBe(false);
  });

  it("is empty, not undefined, for an order with no cards", () => {
    const s = summariseSendSchedule([]);
    expect(s).toEqual({
      dates: [],
      dateCount: 0,
      toCome: 0,
      gone: 0,
      undated: 0,
      earliest: null,
      latest: null,
      isSpread: false,
    });
  });

  it("does not mutate the lines it is given", () => {
    const lines = [card("queued", d("2026-11-02")), card("queued", d("2026-09-04"))];
    const snapshot = JSON.stringify(lines);
    summariseSendSchedule(lines);
    expect(JSON.stringify(lines)).toBe(snapshot);
  });
});

/**
 * The sentences the customer reads. Asserted rather than eyeballed because the
 * wording is the whole point of this change: the readout that prompted the
 * complaint was factually defensible and still left the customer unsure their
 * order had scheduled correctly.
 */
describe("describeSendSchedule", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const card = (status: string, dispatchDate: Date | null) => ({ status, dispatchDate });
  // Fixed and locale-independent, so this suite can't drift with the runner's ICU.
  const fmt = (date: Date) =>
    `${date.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  const describe_ = (lines: Array<ReturnType<typeof card>>) =>
    describeSendSchedule(summariseSendSchedule(lines), fmt);

  it("names the single date, and says 'it' for a one-card order", () => {
    expect(describe_([card("queued", d("2026-09-04"))])).toEqual({
      lead: "we'll post it on 4 Sep 2026.",
      detail: null,
    });
  });

  it("says 'these' for more than one card on a shared date, and adds nothing else", () => {
    const copy = describe_([card("queued", d("2026-09-04")), card("queued", d("2026-09-04"))]);
    expect(copy).toEqual({ lead: "we'll post these on 4 Sep 2026.", detail: null });
  });

  it("gives the range and the count of dates when the cards are spread", () => {
    const copy = describe_([
      card("queued", d("2026-09-04")),
      card("queued", d("2026-10-15")),
      card("queued", d("2026-11-02")),
    ]);
    expect(copy?.lead).toBe("we'll post these on 3 dates, from 4 Sep 2026 to 2 Nov 2026.");
    // This sentence is the answer to the actual complaint.
    expect(copy?.detail).toContain("timed to its own recipient's occasion");
    expect(copy?.detail).toContain("nothing to do");
  });

  it("mentions undated cards, matching what the composer promised before payment", () => {
    const copy = describe_([
      card("queued", d("2026-09-04")),
      card("queued", d("2026-10-15")),
      card("queued", null),
      card("queued", null),
    ]);
    expect(copy?.detail).toContain("2 of these have no occasion on file and go as soon as");
  });

  it("uses singular wording for exactly one undated card", () => {
    const copy = describe_([card("queued", d("2026-09-04")), card("queued", null)]);
    expect(copy?.detail).toContain("1 of these has no occasion on file and goes as soon as it's");
    expect(copy?.detail).not.toContain("have no occasion");
  });

  it("does not claim the undated cards post on the dated one's day", () => {
    // The lead used to speak for every card still to come: "we'll post these on
    // 4 Sep 2026", directly above a detail line saying one of them has no
    // occasion on file and goes as soon as it's printed. Two sentences, and they
    // contradicted each other.
    const copy = describe_([card("queued", d("2026-09-04")), card("queued", null)]);
    expect(copy?.lead).toBe("we'll post one of these on 4 Sep 2026.");
  });

  it("counts the dated cards in the lead when several share a date", () => {
    const copy = describe_([
      card("queued", d("2026-09-04")),
      card("queued", d("2026-09-04")),
      card("queued", null),
    ]);
    expect(copy?.lead).toBe("we'll post 2 of these on 4 Sep 2026.");
    expect(copy?.detail).toContain("1 of these has no occasion on file");
  });

  it("scopes the lead to the dated cards on a spread order too", () => {
    const copy = describe_([
      card("queued", d("2026-09-04")),
      card("queued", d("2026-10-15")),
      card("queued", null),
    ]);
    expect(copy?.lead).toBe("we'll post 2 of these on 2 dates, from 4 Sep 2026 to 15 Oct 2026.");
  });

  it("still says 'it' and 'these' when every card has a date", () => {
    // The undated wording must not leak into the ordinary case, which is most
    // orders.
    expect(describe_([card("queued", d("2026-09-04"))])?.lead).toBe("we'll post it on 4 Sep 2026.");
    expect(
      describe_([card("queued", d("2026-09-04")), card("queued", d("2026-09-04"))])?.lead,
    ).toBe("we'll post these on 4 Sep 2026.");
  });

  it("reports cards already posted instead of pretending the order hasn't started", () => {
    const copy = describe_([
      card("posted", d("2026-09-04")),
      card("posted", d("2026-09-04")),
      card("queued", d("2026-10-15")),
    ]);
    expect(copy?.lead).toBe("we'll post it on 15 Oct 2026.");
    expect(copy?.detail).toBe("2 cards have already been posted.");
  });

  it("uses singular wording for exactly one posted card", () => {
    const copy = describe_([card("posted", d("2026-09-04")), card("queued", d("2026-10-15"))]);
    expect(copy?.detail).toBe("1 card has already been posted.");
  });

  it("returns nothing when there is nothing left to post", () => {
    expect(describe_([card("posted", d("2026-09-04"))])).toBeNull();
    expect(describe_([])).toBeNull();
  });

  it("returns nothing when the only cards left carry no date", () => {
    // Nothing truthful to say about *when*, so the banner stays away rather than
    // inventing a date.
    expect(describe_([card("queued", null)])).toBeNull();
  });

  it("never emits a raw comma-joined list or a stray double space", () => {
    const copy = describe_([
      card("posted", d("2026-09-01")),
      card("queued", d("2026-09-04")),
      card("queued", d("2026-10-15")),
      card("queued", null),
    ]);
    expect(copy?.detail).not.toMatch(/ {2}/);
    expect(copy?.detail).not.toMatch(/,,|\.\./);
    expect(copy?.detail?.endsWith(".")).toBe(true);
  });
});

/**
 * The status tally the orders list carries instead of every card's row.
 */
describe("tallyCardStatuses", () => {
  it("counts each status, and omits the ones that don't occur", () => {
    expect(
      tallyCardStatuses([
        { status: "queued" },
        { status: "queued" },
        { status: "posted" },
        { status: "cancelled" },
      ]),
    ).toEqual({ queued: 2, posted: 1, cancelled: 1 });
  });

  it("is an empty object for an order with no cards, not undefined", () => {
    expect(tallyCardStatuses([])).toEqual({});
  });

  it("stays O(1) in size however many cards an order holds", () => {
    // The point of the tally: a 76-card bulk order and a 2-card one produce the
    // same handful of keys. The list used to carry one 636-byte row per card.
    const many = Array.from({ length: 76 }, () => ({ status: "queued" as const }));
    expect(Object.keys(tallyCardStatuses(many))).toHaveLength(1);
    expect(tallyCardStatuses(many)).toEqual({ queued: 76 });
  });
});

/**
 * Which orders may say "Scheduled" at all.
 *
 * An occasion carries its dispatch date from the moment it is approved, which is
 * before checkout — so a draft order that was never paid for still has a full
 * set of post dates hanging off it. Three screens render this sentence, and
 * without a gate the orders list showed "Scheduled — we'll post it on 4
 * September" directly beside that order's own "Not checked out" pill.
 */
describe("orderScheduleIsLive", () => {
  it("is true only for an order that has been paid for", () => {
    expect(orderScheduleIsLive("paid")).toBe(true);
    expect(orderScheduleIsLive("fulfilling")).toBe(true);
  });

  it("is false for an order that has not been paid for", () => {
    // The bug this exists to prevent: these orders have dispatch dates.
    expect(orderScheduleIsLive("draft")).toBe(false);
    expect(orderScheduleIsLive("pending_payment")).toBe(false);
  });

  it("is false for an order that is over, one way or the other", () => {
    // `completed` has nothing left to come, so the copy would be null anyway —
    // but a refund-cancel leaves any already-printed job dated behind it, and
    // that must not read as still going out.
    expect(orderScheduleIsLive("cancelled")).toBe(false);
    expect(orderScheduleIsLive("completed")).toBe(false);
  });
});
