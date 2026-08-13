import { parseColor } from "./color";

describe("parseColor", () => {
  it("passes six-digit hex through with full opacity", () => {
    expect(parseColor("#4c1d95")).toEqual({ color: "#4c1d95", opacity: 1 });
  });

  it("expands three-digit hex", () => {
    expect(parseColor("#abc")).toEqual({ color: "#aabbcc", opacity: 1 });
  });

  it("splits eight-digit hex into colour + alpha", () => {
    const parsed = parseColor("#00000080");
    expect(parsed.color).toBe("#000000");
    expect(parsed.opacity).toBeCloseTo(128 / 255, 5);
  });

  it("converts rgb() to hex", () => {
    expect(parseColor("rgb(255, 0, 128)")).toEqual({ color: "#ff0080", opacity: 1 });
  });

  it("converts rgba() with alpha", () => {
    const parsed = parseColor("rgba(16, 32, 48, 0.5)");
    expect(parsed.color).toBe("#102030");
    expect(parsed.opacity).toBeCloseTo(0.5, 5);
  });

  it("passes named colours through untouched", () => {
    expect(parseColor("rebeccapurple")).toEqual({ color: "rebeccapurple", opacity: 1 });
  });
});
