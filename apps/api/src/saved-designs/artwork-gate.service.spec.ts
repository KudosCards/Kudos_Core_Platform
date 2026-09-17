import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
import type { ConfigService } from "@nestjs/config";
import type * as PrintPdf from "../print-pdf";
import type { EnvConfig } from "../config/env.schema";
import { idealArtworkPixels, type DesignDocument } from "@kudos/shared-types";
import { fetchAssetBytes } from "../print-pdf";
import { ArtworkGateService } from "./artwork-gate.service";

// Only the network is faked. The host allowlist, the `sharp` read and the
// orientation correction all run for real — they are the parts worth testing.
jest.mock("../print-pdf", () => ({
  ...jest.requireActual<typeof PrintPdf>("../print-pdf"),
  fetchAssetBytes: jest.fn(),
}));
const fetchMock = fetchAssetBytes as jest.MockedFunction<typeof fetchAssetBytes>;

/**
 * The half of the gate a stale tab, a forged request or a future surface cannot
 * get around. See ADR 0248.
 */
describe("ArtworkGateService", () => {
  const STORAGE = "https://store.supabase.co";
  const url = (name: string) => `${STORAGE}/storage/v1/object/public/design-assets/u/${name}`;
  const CATALOG = `${STORAGE}/storage/v1/object/public/design-assets/catalog/KC-1.png`;
  const ELSEWHERE = "https://cdn.example.com/someone-elses.png";

  /** Real bytes, so the measurement is the one production performs. */
  async function png(width: number, height: number, orientation?: number): Promise<Buffer> {
    const image = sharp({
      create: { width, height, channels: 3, background: { r: 120, g: 120, b: 120 } },
    });
    return (orientation ? image.withMetadata({ orientation }) : image).png().toBuffer();
  }

  function serve(bytes: Record<string, Buffer | null>) {
    fetchMock.mockImplementation((assetUrl: string) => {
      const found = bytes[assetUrl];
      return Promise.resolve(found ? { buffer: found, contentType: "image/png" } : null);
    });
  }

  // Only SUPABASE_URL is read, so the stub answers that and nothing else.
  const config = { get: () => STORAGE } as unknown as ConfigService<EnvConfig, true>;
  const service = new ArtworkGateService(config);

  const doc = (backgroundUrl?: string): DesignDocument => ({
    version: 1,
    pages: [
      {
        name: "front",
        elements: [],
        ...(backgroundUrl
          ? { background: { type: "image" as const, assetUrl: backgroundUrl } }
          : {}),
      },
      { name: "inside-left", elements: [] },
      { name: "inside-right", elements: [] },
      { name: "back", elements: [] },
    ],
  });

  beforeEach(() => fetchMock.mockReset());

  it("refuses a wrong-shaped background, naming the size to export at", async () => {
    const bad = url("tall.png");
    serve({ [bad]: await png(1240, 1860) });

    await expect(service.assertAcceptable(doc(bad), doc())).rejects.toThrow(BadRequestException);
    await expect(service.assertAcceptable(doc(bad), doc())).rejects.toThrow(/1240 × 1748/);
  });

  it("accepts the size we ask everyone to export at", async () => {
    const good = url("right.png");
    const { width, height } = idealArtworkPixels("A6");
    serve({ [good]: await png(width, height) });

    await expect(service.assertAcceptable(doc(good), doc())).resolves.toBeUndefined();
  });

  it("accepts a correctly-shaped photo that is stored on its side", async () => {
    // The reason the orientation fix had to land first. This file is stored
    // 1748 x 1240 with a tag saying "turn it" — which is a perfectly shaped
    // portrait card. Measured as stored it reads as heavily cropped landscape
    // and a customer who did exactly what we asked would be refused.
    const photo = url("phone.png");
    const { width, height } = idealArtworkPixels("A6");
    serve({ [photo]: await png(height, width, 6) });

    await expect(service.assertAcceptable(doc(photo), doc())).resolves.toBeUndefined();
  });

  it("leaves a background the design already carried alone", async () => {
    // Accepted once. Refusing it now would trap the customer in a design they
    // can neither fix nor keep — they could not correct a typo on the card.
    const legacy = url("legacy.png");
    serve({ [legacy]: await png(1240, 1860) });

    await expect(service.assertAcceptable(doc(legacy), doc(legacy))).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not judge catalog artwork", async () => {
    // Gated at the sync instead, where it is ours to re-export. Until that lands
    // most of it would fail here, blocking a text edit on somebody else's art.
    serve({ [CATALOG]: await png(1240, 1860) });

    await expect(service.assertAcceptable(doc(CATALOG), doc())).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never fetches a URL that is not our storage", async () => {
    // A design document carries customer-supplied URLs, so an unrestricted
    // server-side fetch here would be the confused-deputy SSRF the print engine
    // is allowlisted against.
    await expect(service.assertAcceptable(doc(ELSEWHERE), doc())).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets the save through when storage does not answer", async () => {
    // Fail open on infrastructure, closed on artwork. A storage blip must not
    // stop every customer saving every design; the pre-upload check already ran.
    const missing = url("gone.png");
    serve({ [missing]: null });

    await expect(service.assertAcceptable(doc(missing), doc())).resolves.toBeUndefined();
  });

  it("lets the save through when the bytes are not an image", async () => {
    const junk = url("notanimage.png");
    serve({ [junk]: Buffer.from("this is not a picture") });

    await expect(service.assertAcceptable(doc(junk), doc())).resolves.toBeUndefined();
  });

  it("does nothing at all when no background changed", async () => {
    await expect(service.assertAcceptable(doc(), doc())).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
