import { corsOriginChecker, isOriginAllowed, normalizeOrigin, parseCommaList } from "./cors";

describe("normalizeOrigin", () => {
  it("trims whitespace and strips trailing slashes", () => {
    expect(normalizeOrigin("  https://kudos-cards.co.uk/  ")).toBe("https://kudos-cards.co.uk");
    expect(normalizeOrigin("https://kudos-cards.co.uk///")).toBe("https://kudos-cards.co.uk");
  });
});

describe("parseCommaList", () => {
  it("returns [] for undefined/blank", () => {
    expect(parseCommaList(undefined)).toEqual([]);
    expect(parseCommaList("")).toEqual([]);
    expect(parseCommaList("  ,  ")).toEqual([]);
  });

  it("splits, trims, and drops empties", () => {
    expect(parseCommaList("https://a.co, https://b.co ,")).toEqual([
      "https://a.co",
      "https://b.co",
    ]);
  });
});

describe("isOriginAllowed", () => {
  const allowed = ["https://kudos-cards.co.uk", "https://www.kudos-cards.co.uk"];
  const suffixes = ["--kudos-cards.netlify.app"];

  it("allows an exact match (slash-insensitive)", () => {
    expect(isOriginAllowed("https://kudos-cards.co.uk", allowed, suffixes)).toBe(true);
    expect(isOriginAllowed("https://kudos-cards.co.uk/", allowed, suffixes)).toBe(true);
    expect(isOriginAllowed("https://www.kudos-cards.co.uk", allowed, suffixes)).toBe(true);
  });

  it("allows a configured suffix (deploy previews)", () => {
    expect(
      isOriginAllowed("https://deploy-preview-42--kudos-cards.netlify.app", allowed, suffixes),
    ).toBe(true);
  });

  it("rejects an unlisted origin — including a scheme typo and a bare host swap", () => {
    expect(isOriginAllowed("https://kudos-cards.netlify.app", allowed, suffixes)).toBe(false);
    expect(isOriginAllowed("ttps://kudos-cards.co.uk", allowed, suffixes)).toBe(false);
    expect(isOriginAllowed("https://evil.example.com", allowed, suffixes)).toBe(false);
  });

  it("does not treat suffixes as substrings of an arbitrary host", () => {
    // Endswith, not includes: a look-alike host that merely contains the suffix
    // mid-string is not allowed.
    expect(
      isOriginAllowed("https://--kudos-cards.netlify.app.evil.com", allowed, suffixes),
    ).toBe(false);
  });
});

describe("corsOriginChecker", () => {
  const check = corsOriginChecker(["https://kudos-cards.co.uk"], ["--kudos-cards.netlify.app"]);

  const decideFn = check as (
    requestOrigin: string,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => void;

  function decide(origin: string | undefined): boolean {
    let allowed = false;
    decideFn(origin as string, (_err, ok) => {
      allowed = ok === true;
    });
    return allowed;
  }

  it("allows requests with no Origin header (same-origin / server-to-server)", () => {
    expect(decide(undefined)).toBe(true);
  });

  it("allows a listed origin and a preview suffix", () => {
    expect(decide("https://kudos-cards.co.uk")).toBe(true);
    expect(decide("https://deploy-preview-1--kudos-cards.netlify.app")).toBe(true);
  });

  it("refuses (without throwing) an unlisted origin", () => {
    expect(() => decide("https://kudos-cards.netlify.app")).not.toThrow();
    expect(decide("https://kudos-cards.netlify.app")).toBe(false);
  });
});
