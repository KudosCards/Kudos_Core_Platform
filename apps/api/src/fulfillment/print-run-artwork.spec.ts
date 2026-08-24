import { originalFileName } from "./print-run-artwork.service";

/**
 * The name the operator's browser saves the file under. It comes out of an
 * upload path, so it is customer-controlled and lands in a response header —
 * two reasons to pin its behaviour rather than trust it.
 */
describe("originalFileName", () => {
  const base = "https://xyz.supabase.co/storage/v1/object/public/design-assets/acc-1";

  it("recovers the customer's own file name from the storage path", () => {
    // Uploads are stored as <accountId>/<uuid>-<original name>.
    expect(
      originalFileName(`${base}/0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b-partner-offers.png`),
    ).toBe("partner-offers.png");
  });

  it("decodes a percent-encoded name", () => {
    expect(
      originalFileName(`${base}/0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b-back%20artwork.jpg`),
    ).toBe("back artwork.jpg");
  });

  it("keeps a name that carries no uuid prefix", () => {
    // Older assets, or anything uploaded by another route — better a real name
    // than a mangled one.
    expect(originalFileName(`${base}/logo.svg`)).toBe("logo.svg");
  });

  it("strips quotes, backslashes and control characters", () => {
    // These land in `Content-Disposition: attachment; filename="…"`, where one
    // stray quote ends the field and the rest is attacker-chosen header content.
    const name = originalFileName(`${base}/0f9c1a2b-3d4e-5f60-8a9b-0c1d2e3f4a5b-a%22b%5Cc%0Ad.png`);
    expect(name).toBe("abcd.png");
    expect(name).not.toMatch(/["\\\n\r]/);
  });

  it("falls back rather than returning an empty name", () => {
    expect(originalFileName(`${base}/`)).toBe("artwork");
    expect(originalFileName("not a url at all")).toBe("artwork");
  });
});
