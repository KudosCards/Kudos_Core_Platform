import { splitGlyphRuns, type GlyphCoverage } from "./glyph-runs";

/** A coverage probe from an explicit allow-set of code points. */
function coverOf(...chars: string[]): GlyphCoverage {
  const set = new Set(chars.map((c) => c.codePointAt(0)!));
  return { covers: (cp) => set.has(cp) };
}

/** Coverage of every printable ASCII code point (a stand-in "Latin" primary). */
const ascii: GlyphCoverage = { covers: (cp) => cp >= 0x20 && cp <= 0x7e };

describe("splitGlyphRuns", () => {
  it("keeps all-primary text as a single run", () => {
    const runs = splitGlyphRuns("Happy Birthday", [ascii, coverOf("😀")]);
    expect(runs).toEqual([{ text: "Happy Birthday", fontIndex: 0 }]);
  });

  it("routes a missing glyph to the first fallback that covers it", () => {
    const emoji = coverOf("😀");
    const runs = splitGlyphRuns("Hi 😀!", [ascii, emoji]);
    expect(runs).toEqual([
      { text: "Hi ", fontIndex: 0 },
      { text: "😀", fontIndex: 1 },
      { text: "!", fontIndex: 0 },
    ]);
  });

  it("prefers an earlier fallback when several cover a glyph", () => {
    const symbols = coverOf("♥");
    const emoji = coverOf("♥", "😀");
    // ♥ is in both fallbacks; the earlier (symbols, index 1) wins.
    const runs = splitGlyphRuns("x♥", [ascii, symbols, emoji]);
    expect(runs).toEqual([
      { text: "x", fontIndex: 0 },
      { text: "♥", fontIndex: 1 },
    ]);
  });

  it("merges consecutive glyphs that share a font into one run", () => {
    const emoji = coverOf("😀", "🎉");
    const runs = splitGlyphRuns("😀🎉", [ascii, emoji]);
    expect(runs).toEqual([{ text: "😀🎉", fontIndex: 1 }]);
  });

  it("does not split an astral character across its surrogate pair", () => {
    // 😀 is U+1F600 (a surrogate pair in UTF-16); it must stay one unit.
    const emoji = coverOf("😀");
    const runs = splitGlyphRuns("😀", [ascii, emoji]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ text: "😀", fontIndex: 1 });
    expect([...runs[0]!.text]).toHaveLength(1);
  });

  it("assigns a glyph no font covers to the primary (best-effort, not dropped)", () => {
    // 🧠 is covered by neither font → primary (index 0), so it stays in the run
    // with the surrounding primary text rather than being dropped.
    const runs = splitGlyphRuns("a\u{1F9E0}b", [ascii, coverOf("😀")]);
    expect(runs).toEqual([{ text: "a\u{1F9E0}b", fontIndex: 0 }]);
  });

  it("keeps a ZWJ emoji sequence on the emoji font", () => {
    // 👩‍🚀 = 👩 + ZWJ + 🚀. The ZWJ is sticky, so the whole sequence stays index 1.
    const emoji = coverOf("👩", "🚀");
    const runs = splitGlyphRuns("👩‍🚀", [ascii, emoji]);
    expect(runs).toEqual([{ text: "👩‍🚀", fontIndex: 1 }]);
  });

  it("keeps a variation selector with its base glyph", () => {
    // ❤ + VS16 (emoji presentation). VS16 is sticky → stays with ❤ on index 1.
    const emoji = coverOf("❤");
    const runs = splitGlyphRuns("❤️", [ascii, emoji]);
    expect(runs).toEqual([{ text: "❤️", fontIndex: 1 }]);
  });

  it("returns nothing for an empty string", () => {
    expect(splitGlyphRuns("", [ascii])).toEqual([]);
  });
});
