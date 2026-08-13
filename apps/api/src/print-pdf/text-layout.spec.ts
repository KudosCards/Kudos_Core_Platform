import { alignOffset, baselineMetrics, LINE_HEIGHT, wrapText } from "./text-layout";

/** A deterministic measurer: every character is one unit wide. Lets us assert
 * wrapping precisely without a real font. */
const measureMono = (s: string) => s.length;

describe("wrapText", () => {
  it("greedily packs words within the box width", () => {
    // width 10 → "the quick" (9) fits, adding " brown" (15) does not.
    expect(wrapText("the quick brown fox", 10, measureMono)).toEqual(["the quick", "brown fox"]);
  });

  it("keeps a lone word that fits on its own line", () => {
    expect(wrapText("hello world", 5, measureMono)).toEqual(["hello", "world"]);
  });

  it("honours explicit newlines as paragraph breaks", () => {
    expect(wrapText("line one\nline two", 100, measureMono)).toEqual(["line one", "line two"]);
  });

  it("preserves a blank line from a double newline", () => {
    expect(wrapText("a\n\nb", 100, measureMono)).toEqual(["a", "", "b"]);
  });

  it("hard-breaks a single word wider than the box", () => {
    // "abcdef" in width 3 → "abc", "def".
    expect(wrapText("abcdef", 3, measureMono)).toEqual(["abc", "def"]);
  });

  it("never drops content when a long word follows text", () => {
    const lines = wrapText("hi abcdefgh", 3, measureMono);
    expect(lines.join("")).toContain("abcdefgh".slice(0, 3));
    expect(lines.join(" ").replace(/\s+/g, "")).toBe("hiabcdefgh");
  });
});

describe("alignOffset", () => {
  it("offsets left/center/right within the box", () => {
    expect(alignOffset("left", 100, 40)).toBe(0);
    expect(alignOffset("center", 100, 40)).toBe(30);
    expect(alignOffset("right", 100, 40)).toBe(60);
  });
});

describe("baselineMetrics", () => {
  it("computes Konva's line pitch and first alphabetic baseline", () => {
    const fontSize = 20;
    const ascentEm = 0.9;
    const descentEm = 0.2;
    const { lineHeightPx, firstBaseline } = baselineMetrics(fontSize, ascentEm, descentEm);
    expect(lineHeightPx).toBeCloseTo(LINE_HEIGHT * fontSize, 6);
    // (ascent - descent)/2 + lineHeightPx/2 = (18-4)/2 + 26/2 = 7 + 13 = 20.
    expect(firstBaseline).toBeCloseTo(20, 6);
  });
});
