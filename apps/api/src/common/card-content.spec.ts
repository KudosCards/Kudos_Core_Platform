import type { DesignDocument, DesignElement, DesignPage, TextElement } from "@kudos/shared-types";
import {
  estimatedTextBox,
  literalNamesIn,
  OVERLAP_MIN_FRACTION,
  salutationNames,
  stackedTextInDocument,
  stackedTextOnPage,
} from "@kudos/shared-types";

/**
 * The two cards that prompted this module, written down as tests.
 *
 * Both came out of the super-admin order cockpit, both were printed exactly as
 * the document asked, and neither was caught by anything. See
 * docs/card-content-preflight-plan.md.
 */

function text(over: Partial<TextElement>): TextElement {
  return {
    kind: "text",
    id: "t",
    text: "Hello",
    x: 40,
    y: 40,
    fontFamily: "Helvetica",
    fontSize: 16,
    color: "#000000",
    ...over,
  };
}

function page(name: DesignPage["name"], elements: DesignElement[]): DesignPage {
  return { name, elements };
}

function doc(pages: DesignPage[]): DesignDocument {
  return { version: 1, pages };
}

describe("estimatedTextBox", () => {
  it("counts each authored line, blank lines included", () => {
    // A blank line between paragraphs costs a line on the card, so it costs one
    // here — otherwise a spaced-out message measures as half its real height and
    // slips under the overlap threshold.
    const one = estimatedTextBox(text({ text: "One", fontSize: 20, width: 300 }));
    const three = estimatedTextBox(text({ text: "One\n\nTwo", fontSize: 20, width: 300 }));

    expect(one!.height).toBeCloseTo(20 * 1.3, 5);
    expect(three!.height).toBeCloseTo(3 * 20 * 1.3, 5);
  });

  it("wraps a long line into more than one", () => {
    const short = estimatedTextBox(text({ text: "Hi", fontSize: 16, width: 120 }));
    const long = estimatedTextBox(text({ text: "x".repeat(200), fontSize: 16, width: 120 }));

    expect(long!.height).toBeGreaterThan(short!.height);
  });

  it("declines to box a rotated element", () => {
    // An axis-aligned box is the wrong shape for it, and a rotated text block is
    // deliberate design rather than the accident this module looks for.
    expect(estimatedTextBox(text({ rotation: 12 }))).toBeNull();
  });

  it("narrows the box to the text, not the box the text may fill", () => {
    // A short line in a wide text box leaves most of that box empty. Treating
    // the empty part as occupied is how a caption beside a heading gets
    // reported as sitting on top of it.
    const short = estimatedTextBox(text({ text: "Hi", fontSize: 16, width: 400 }))!;
    expect(short.width).toBeLessThan(100);

    // A line long enough to fill the box measures very nearly the whole box, and
    // never more than it — the ink is a whole number of characters, so it stops
    // just short rather than landing exactly on the boundary.
    const full = estimatedTextBox(text({ text: "x".repeat(400), fontSize: 16, width: 400 }))!;
    expect(full.width).toBeLessThanOrEqual(400);
    expect(full.width).toBeGreaterThan(400 - 16);
  });

  it("puts the ink where the alignment puts it", () => {
    // Same string, same box: left-aligned starts at x, right-aligned finishes at
    // the box's right edge, centred sits between them.
    const common = { text: "Kip x", fontSize: 16, width: 300, x: 50 } as const;
    const left = estimatedTextBox(text({ ...common }))!;
    const centre = estimatedTextBox(text({ ...common, align: "center" }))!;
    const right = estimatedTextBox(text({ ...common, align: "right" }))!;

    expect(left.x).toBe(50);
    expect(centre.x).toBeGreaterThan(left.x);
    expect(right.x).toBeGreaterThan(centre.x);
    expect(right.x + right.width).toBeCloseTo(50 + 300, 5);
  });

  it("wraps to the card's right edge when no width is set", () => {
    // Legacy behaviour: a long line with no explicit box fills to the edge less
    // the standard padding.
    const box = estimatedTextBox(text({ x: 40, text: "x".repeat(500), fontSize: 16 }))!;
    const toTheEdge = 450 - 40 - 16;
    expect(box.width).toBeLessThanOrEqual(toTheEdge);
    expect(box.width).toBeGreaterThan(toTheEdge - 16);
  });
});

describe("stackedTextOnPage", () => {
  it("finds Elise's card: two messages written on top of each other", () => {
    // The real one. A message for Florence, a message for Elise, both left in
    // the same design, and the whole batch printed both.
    const florence = text({
      id: "florence",
      text: "To Florence,\n\nHappy Birthday!\n\nHave a lovely day,\n\nFrom all of your friends at Kip x",
      x: 60,
      y: 150,
      fontSize: 18,
      width: 330,
    });
    const elise = text({
      id: "elise",
      text: "To {firstName}\n\nHappy Birthday!\n\nWe hope you have a fantastic day,\n\nFrom all of your friends at Kip x",
      x: 60,
      y: 120,
      fontSize: 18,
      width: 330,
    });

    const stacked = stackedTextOnPage(page("inside-right", [elise, florence]));

    expect(stacked).toHaveLength(1);
    expect(stacked[0]!.ids).toEqual(["elise", "florence"]);
    expect(stacked[0]!.fraction).toBeGreaterThan(OVERLAP_MIN_FRACTION);
    // The texts come back so a warning can quote what it actually found.
    expect(stacked[0]!.texts[1]).toContain("Florence");
  });

  it("leaves two messages that simply sit apart alone", () => {
    const top = text({
      id: "top",
      text: "Happy Birthday!",
      x: 40,
      y: 40,
      fontSize: 18,
      width: 300,
    });
    const bottom = text({
      id: "bottom",
      text: "From Kip x",
      x: 40,
      y: 400,
      fontSize: 18,
      width: 300,
    });

    expect(stackedTextOnPage(page("inside-right", [top, bottom]))).toEqual([]);
  });

  it("leaves a caption clipping the corner of a banner alone", () => {
    // Text over text is legitimate design. Only a substantial share of the
    // smaller block counts as a stack — otherwise the warning fires on cards
    // that are fine and people learn to dismiss it.
    const banner = text({
      id: "banner",
      text: "Congratulations",
      x: 40,
      y: 40,
      fontSize: 40,
      width: 360,
    });
    const caption = text({ id: "caption", text: "!", x: 380, y: 80, fontSize: 10, width: 40 });

    expect(stackedTextOnPage(page("front", [banner, caption]))).toEqual([]);
  });

  it("ignores an empty text box", () => {
    // It occupies no space and cannot be read, so it is not a message sitting on
    // another one — and a stray empty box is easy to leave behind in the editor.
    const message = text({ id: "message", text: "Happy Birthday!", x: 40, y: 40, width: 300 });
    const blank = text({ id: "blank", text: "   ", x: 40, y: 40, width: 300 });

    expect(stackedTextOnPage(page("inside-right", [message, blank]))).toEqual([]);
  });

  it("does not report an element against itself, or a pair twice", () => {
    const a = text({ id: "a", text: "One message", x: 40, y: 40, width: 300 });
    const b = text({ id: "b", text: "Another message", x: 40, y: 45, width: 300 });

    expect(stackedTextOnPage(page("inside-right", [a, b]))).toHaveLength(1);
  });
});

describe("stackedTextInDocument", () => {
  it("names the face, and omits the faces with nothing to say", () => {
    const a = text({ id: "a", text: "To Elise", x: 40, y: 40, width: 300 });
    const b = text({ id: "b", text: "To Florence", x: 40, y: 44, width: 300 });

    const faces = stackedTextInDocument(
      doc([page("front", []), page("inside-right", [a, b]), page("back", [])]),
    );

    expect(faces).toHaveLength(1);
    expect(faces[0]!.face).toBe("inside-right");
  });

  it("reads an unparseable document as nothing found rather than throwing", () => {
    // It runs on a checkout path. A TypeError here is a 500 on a customer's
    // payment over a document we simply could not read.
    expect(stackedTextInDocument({} as DesignDocument)).toEqual([]);
    expect(stackedTextInDocument({ version: 1, pages: null } as unknown as DesignDocument)).toEqual(
      [],
    );
    expect(
      stackedTextInDocument({
        version: 1,
        pages: [{ name: "front" }],
      } as unknown as DesignDocument),
    ).toEqual([]);
  });
});

describe("literalNamesIn", () => {
  it("finds Cole's card: a message addressed by hand to somebody else", () => {
    // The other real one — a card for Cole Fortes carrying a message to "alex".
    const document = doc([
      page("inside-right", [text({ text: "Dear alex,\n\nWell done!\n\nFrom Kip x" })]),
    ]);

    expect(literalNamesIn(document, ["Cole", "Alex"])).toEqual([
      { face: "inside-right", name: "Alex", text: "Dear alex,\n\nWell done!\n\nFrom Kip x" },
    ]);
  });

  it("never matches a design written properly, with a merge token", () => {
    // The whole point. `To {firstName}` is the correct way to write this and
    // must never be flagged, however the recipient happens to be called.
    const document = doc([
      page("inside-right", [text({ text: "To {firstName}, have a lovely day" })]),
    ]);

    expect(literalNamesIn(document, ["firstName", "Elise"])).toEqual([]);
  });

  it("matches whole words only, and ignores case", () => {
    const document = doc([page("inside-right", [text({ text: "Always welcome, ALEX!" })])]);

    // "Al" must not be found inside "Always"; "ALEX" must be found regardless of case.
    expect(literalNamesIn(document, ["Al"])).toEqual([]);
    expect(literalNamesIn(document, ["Alex"]).map((f) => f.name)).toEqual(["Alex"]);
  });

  it("handles a name carrying punctuation without blowing up the pattern", () => {
    const document = doc([
      page("inside-right", [text({ text: "To Anne-Marie, congratulations" })]),
    ]);

    expect(literalNamesIn(document, ["Anne-Marie"]).map((f) => f.name)).toEqual(["Anne-Marie"]);
    expect(literalNamesIn(document, ["A.*"])).toEqual([]);
  });

  it("says nothing when there are no names to look for", () => {
    const document = doc([page("inside-right", [text({ text: "Happy Birthday!" })])]);

    expect(literalNamesIn(document, [])).toEqual([]);
    expect(literalNamesIn(document, ["  "])).toEqual([]);
  });

  it("reads an unparseable document as nothing found rather than throwing", () => {
    expect(literalNamesIn({} as DesignDocument, ["Elise"])).toEqual([]);
  });
});

describe("salutationNames", () => {
  it("finds the person a card is addressed to, in whatever case they typed", () => {
    // Cole Fortes's card opened "Dear alex,". A check that only noticed
    // capitalised names would have missed the one that actually went wrong.
    const document = doc([
      page("inside-right", [text({ text: "Dear alex,\n\nWell done!\n\nFrom Kip x" })]),
    ]);

    expect(salutationNames(document).map((f) => f.name)).toEqual(["alex"]);
  });

  it("finds a salutation written with any of the usual openers", () => {
    for (const opener of ["To", "Dear", "Hi", "Hello", "Hey"]) {
      const document = doc([page("front", [text({ text: `${opener} Florence,\n\nEnjoy!` })])]);
      expect(salutationNames(document).map((f) => f.name)).toEqual(["Florence"]);
    }
  });

  it("leaves a card addressed to a relationship alone", () => {
    // "To Mum" and "To the team" are perfectly good cards. Flagging them is the
    // false positive that teaches people to ignore the warning.
    for (const line of ["To Mum", "Dear Grandad,", "Hi everyone!", "To the team", "To all"]) {
      const document = doc([page("inside-right", [text({ text: `${line}\n\nWell done!` })])]);
      expect(salutationNames(document)).toEqual([]);
    }
  });

  it("does not mistake a sentence containing 'to' for a salutation", () => {
    // The reason a salutation must be the whole line. Without that rule this
    // reads "Kip" as the person the card is addressed to.
    const document = doc([
      page("front", [text({ text: "Welcome to Kip McGrath\n\nWe are glad to have you" })]),
    ]);

    expect(salutationNames(document)).toEqual([]);
  });

  it("never reads a name out of a merge token", () => {
    // `To {firstName}` is the correct way to write this, and the reason the
    // tokens are stripped before anything is matched.
    const document = doc([
      page("inside-right", [text({ text: "To {firstName}\n\nHappy Birthday!" })]),
    ]);

    expect(salutationNames(document)).toEqual([]);
  });

  it("names the face it found the salutation on", () => {
    const document = doc([
      page("front", []),
      page("inside-right", [text({ text: "To Florence,\n\nHave a lovely day" })]),
    ]);

    expect(salutationNames(document)[0]).toMatchObject({ face: "inside-right", name: "Florence" });
  });

  it("reads an unparseable document as nothing found rather than throwing", () => {
    expect(salutationNames({} as DesignDocument)).toEqual([]);
  });
});
