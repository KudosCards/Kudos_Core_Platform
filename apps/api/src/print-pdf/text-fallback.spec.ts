import type { DesignDocument } from "@kudos/shared-types";
import { renderRunPdf } from "./render";
import { coverageForFace } from "./coverage";
import { fallbackFaces, resolveFace } from "./fonts";

/** A one-face document whose only element is a text box with `text`. */
function docWithText(text: string, fontFamily = "Montserrat"): DesignDocument {
  return {
    version: 1,
    pages: [
      {
        name: "front",
        elements: [
          {
            kind: "text",
            id: "t",
            text,
            x: 30,
            y: 40,
            width: 380,
            fontFamily,
            fontSize: 40,
            color: "#111111",
          },
        ],
      },
    ],
  };
}

/** The PostScript names of the fonts pdfkit embedded (subset tag stripped). */
function embeddedFonts(pdf: Buffer): Set<string> {
  const names = [...pdf.toString("latin1").matchAll(/[A-Z]{6}\+([A-Za-z0-9]+)-/g)].map(
    (m) => m[1]!,
  );
  return new Set(names);
}

describe("text fallback rendering (docs/adr/0162 Phase 3)", () => {
  it("draws an emoji from the Noto Emoji fallback, not a missing-glyph box", async () => {
    const pdf = await renderRunPdf([{ document: docWithText("Congrats 😀"), face: "front" }]);
    const fonts = embeddedFonts(pdf);
    expect(fonts).toContain("NotoEmoji");
    expect(fonts).toContain("Montserrat"); // the Latin still uses the chosen font
  });

  it("draws stars and card suits from the Noto Sans Symbols 2 fallback", async () => {
    const pdf = await renderRunPdf([{ document: docWithText("★ ♥ ♦"), face: "front" }]);
    expect(embeddedFonts(pdf)).toContain("NotoSansSymbols2");
  });

  it("embeds only the primary font for pure-Latin text (no fallback churn)", async () => {
    const pdf = await renderRunPdf([{ document: docWithText("Happy Birthday Jo"), face: "front" }]);
    const fonts = embeddedFonts(pdf);
    expect(fonts).toContain("Montserrat");
    expect([...fonts].some((n) => n.startsWith("Noto"))).toBe(false);
  });

  it("still produces a valid multi-glyph PDF when text mixes scripts and emoji", async () => {
    const pdf = await renderRunPdf([{ document: docWithText("Dear Zoë 🎉 — ★"), face: "front" }]);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe("coverageForFace", () => {
  it("reports exact cmap coverage for an embedded face", () => {
    const cov = coverageForFace(resolveFace("Montserrat", false, false));
    expect(cov.covers("A".codePointAt(0)!)).toBe(true);
    expect(cov.covers(0x1f600)).toBe(false); // 😀 not in Montserrat
  });

  it("reports WinAnsi coverage for a built-in standard face (no TTF)", () => {
    const cov = coverageForFace(resolveFace("Helvetica", false, false));
    expect(cov.covers("A".codePointAt(0)!)).toBe(true);
    expect(cov.covers("é".codePointAt(0)!)).toBe(true); // Latin-1
    expect(cov.covers("€".codePointAt(0)!)).toBe(true); // CP1252 extra
    expect(cov.covers(0x2605)).toBe(false); // ★ outside WinAnsi → falls back
    expect(cov.covers(0x1f600)).toBe(false); // 😀 outside WinAnsi
  });

  it("exposes the fallback chain in priority order", () => {
    expect(fallbackFaces().map((f) => f.id)).toEqual([
      "NotoSans-Regular",
      "NotoSansSymbols-Regular",
      "NotoSansSymbols2-Regular",
      "NotoEmoji-Regular",
    ]);
  });
});
