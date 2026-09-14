import { CATALOG_ASSET_PREFIX, isCatalogArtwork } from "@kudos/shared-types";

/**
 * Telling our artwork apart from the customer's.
 *
 * The editor warns when a background image will be cropped, and tells whoever
 * is looking to re-export it at the card's proportion. On artwork *they*
 * uploaded that is exactly right. On a catalog design it is advice about a file
 * they have never seen and cannot replace — and since 207 of 217 catalog
 * designs are cropped, that is a remedy-they-cannot-perform on almost every
 * design on the platform.
 *
 * The two live at structurally different paths in the same bucket, both written
 * by us: the sync stores catalog artwork under `catalog/`, and a member upload
 * is scoped to their account id. See docs/card-artwork-shape-plan.md, Phase 3.
 */
describe("isCatalogArtwork", () => {
  const BUCKET = "https://x.supabase.co/storage/v1/object/public/design-assets";

  it("recognises artwork the catalog sync stored", () => {
    expect(isCatalogArtwork(`${BUCKET}/catalog/recABC123.png`)).toBe(true);
    expect(isCatalogArtwork(`${BUCKET}/catalog/recABC123.jpeg`)).toBe(true);
  });

  it("does not claim a member's own upload", () => {
    // `<accountId>/<uuid>-<filename>` — what createSignedUpload builds.
    expect(isCatalogArtwork(`${BUCKET}/0cf52369-1c8d-4e78-a26f-e6227dff75d7/6f1e-photo.png`)).toBe(
      false,
    );
  });

  it("is not fooled by the word appearing somewhere else in the url", () => {
    // The discriminator. A member can name a file anything, including
    // "catalog.png", and a bare `includes("catalog")` would hand them our
    // excuse for not helping.
    expect(isCatalogArtwork(`${BUCKET}/0cf52369-1c8d/catalog.png`)).toBe(false);
    expect(isCatalogArtwork(`${BUCKET}/0cf52369-1c8d/my-catalog/front.png`)).toBe(false);
    expect(isCatalogArtwork(`${BUCKET}/not-catalog/front.png`)).toBe(false);
  });

  it("says no to anything that is not a url we recognise", () => {
    expect(isCatalogArtwork("")).toBe(false);
    expect(isCatalogArtwork("not a url")).toBe(false);
    expect(isCatalogArtwork("https://elsewhere.test/catalog/front.png")).toBe(false);
  });

  it("exposes the prefix the sync writes, so the two cannot drift apart", () => {
    expect(CATALOG_ASSET_PREFIX).toBe("catalog/");
  });
});
